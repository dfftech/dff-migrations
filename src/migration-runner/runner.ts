import type { SQL } from "bun";
import { quoteIdent } from "../db/sql-util";
import { merr, mlog, mtx } from "./log";
import { loadSqlOrder, sqlFilePath, versionActionDir, type MigrationAction, type MigrationTrack } from "./order";

export type RunCtx = {
  action: MigrationAction;
  version?: string;
  tenant?: string;
  schema?: string;
  track?: MigrationTrack;
};

export type VersionResult = { version: string; action: MigrationAction; files: string[] };

/** One version's ordered .sql files (loaded before the transaction opens). */
type VersionStep = { version: string; files: string[] };

/**
 * Everything one schema transaction needs. All versions for the schema run in
 * a single transaction; currentVersion/currentFile track progress for error logs.
 */
type SchemaPlan = {
  ctx: RunCtx;
  track: MigrationTrack;
  action: MigrationAction;
  schema?: string;
  steps: VersionStep[];
  currentVersion: string;
  currentFile: string;
  currentPath: string;
};

type SearchPathRow = { search_path: string };

function firstSchema(searchPath: string): string {
  const first = searchPath.split(",")[0]?.trim().replace(/^"|"$/g, "") || "public";
  return first === "$user" ? "public" : first;
}

/** Load every version's z-order.yaml up front, so a missing file fails before BEGIN. */
async function loadSteps(versions: string[], ctx: RunCtx, track: MigrationTrack): Promise<VersionStep[]> {
  const steps: VersionStep[] = [];
  for (const version of versions) {
    const versionCtx = { ...ctx, version };
    const files = await loadSqlOrder(track, version, ctx.action, versionCtx);
    mlog(versionCtx, `version planned files=${files.length} dir=${versionActionDir(track, version, ctx.action)}`);
    steps.push({ version, files });
  }
  return steps;
}

/** Resolve the target schema (explicit, or first entry of search_path), create it, pin it for the tx. */
async function prepareSchema(plan: SchemaPlan, tx: SQL): Promise<void> {
  let schema = plan.schema?.trim();
  if (!schema) {
    const rows: SearchPathRow[] = await tx`SHOW search_path`;
    schema = firstSchema(String(rows[0]?.search_path ?? "public"));
  }
  plan.schema = schema;
  plan.ctx.schema = schema;
  await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
  await tx.unsafe(`SET LOCAL search_path TO ${quoteIdent(schema)}`);
  mlog(plan.ctx, "schema ready (in transaction)");
}

/** Run one .sql file inside the schema transaction, streamed by Bun.SQL (`tx.file`). */
async function applySqlFile(plan: SchemaPlan, tx: SQL, version: string, name: string): Promise<void> {
  const path = sqlFilePath(plan.track, version, plan.action, name);
  const fileCtx = { ...plan.ctx, version, file: `${name}.sql` };
  plan.currentFile = fileCtx.file;
  plan.currentPath = path;

  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`[migration] missing file: ${path}`);
  if (file.size === 0) {
    mlog({ ...fileCtx, phase: "skip" }, "empty");
    return;
  }

  mlog({ ...fileCtx, phase: "begin" });
  await tx.file(path);
  mlog({ ...fileCtx, phase: "end" });
}

async function applyStep(plan: SchemaPlan, tx: SQL, step: VersionStep): Promise<void> {
  plan.currentVersion = step.version;
  mlog({ ...plan.ctx, version: step.version }, "version begin");
  for (const name of step.files) {
    await applySqlFile(plan, tx, step.version, name);
  }
  mlog({ ...plan.ctx, version: step.version }, "version applied");
}

/** sql.begin callback: schema + every version + every file, all-or-nothing. */
async function applySchemaPlan(plan: SchemaPlan, tx: SQL): Promise<void> {
  mtx(plan.ctx, "BEGIN TRANSACTION", `versions=${versionList(plan)}`);
  await prepareSchema(plan, tx);
  for (const step of plan.steps) {
    await applyStep(plan, tx, step);
  }
}

/** SQL text of the failing file, for the error log (best effort). */
async function failedSqlText(path: string): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await Bun.file(path).text();
  } catch {
    return undefined;
  }
}

function versionList(plan: SchemaPlan): string {
  const versions: string[] = [];
  for (const step of plan.steps) {
    versions.push(step.version);
  }
  return versions.join(",");
}

function stepResults(plan: SchemaPlan): VersionResult[] {
  const results: VersionResult[] = [];
  for (const step of plan.steps) {
    results.push({ version: step.version, action: plan.action, files: step.files });
  }
  return results;
}

/**
 * Run versions (in order) on one schema inside ONE transaction:
 * any failure rolls back every version and file for that schema.
 */
export async function runVersionsOnPool(
  db: SQL,
  versions: string[],
  action: MigrationAction,
  tenant?: string,
  schema?: string,
  track: MigrationTrack = "tenants"
): Promise<VersionResult[]> {
  const ctx: RunCtx = { action, tenant, schema, track };
  mlog(ctx, `schema transaction begin versions=${versions.join(" → ")}`);

  const plan: SchemaPlan = {
    ctx,
    track,
    action,
    schema,
    steps: await loadSteps(versions, ctx, track),
    currentVersion: "",
    currentFile: "",
    currentPath: "",
  };

  try {
    await db.begin(applySchemaPlan.bind(null, plan));
  } catch (err) {
    const failedSql = await failedSqlText(plan.currentPath);
    const failCtx = { ...plan.ctx, version: plan.currentVersion || undefined, file: plan.currentFile || undefined };
    merr({ ...failCtx, phase: "fail" }, "schema transaction failed", err, failedSql);
    mtx(plan.ctx, "ROLLBACK", `versions=${versionList(plan)}`, err);
    throw err;
  }

  mtx(plan.ctx, "COMMIT", `versions=${versionList(plan)}`);
  return stepResults(plan);
}

/** Single version on one schema (its own transaction). */
export async function runMigrationOnPool(
  db: SQL,
  version: string,
  action: MigrationAction,
  tenant?: string,
  schema?: string,
  track: MigrationTrack = "tenants"
): Promise<VersionResult> {
  const results = await runVersionsOnPool(db, [version], action, tenant, schema, track);
  return results[0] as VersionResult;
}
