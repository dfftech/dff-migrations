import type { SQL } from "bun";
import {
  APP_SCHEMA,
  CORE_TENANT_ID,
  IS_TENANT,
  ensure_tenants_db_init,
  get_core_db,
  get_tenant_db,
  is_core_tenant,
  tenant_ids,
} from "../db/db-connection";
import { pull_repo } from "../git/clone-repo";
import { merr, mlog } from "./log";
import {
  ADMIN_TRACK,
  TENANTS_TRACK,
  Z_ORDER,
  isZOrderRef,
  loadTopVersionOrder,
  type MigrationAction,
  type MigrationTrack,
} from "./order";
import { runVersionsOnPool, type VersionResult } from "./runner";

type Target = { pool: SQL; tenant: string; schema?: string };

type TargetResult = { tenant: string; schema?: string; versions: VersionResult[] };

export type MigrationRunResult = {
  action: MigrationAction;
  version: string;
  track: MigrationTrack;
  versions: string[];
  tenants: string[];
  results: TargetResult[];
};

async function ready(action: MigrationAction, version: string, target?: string): Promise<void> {
  mlog({ action, version, tenant: target }, "ready begin");
  await ensure_tenants_db_init();
  await pull_repo();
  const schema = IS_TENANT ? undefined : APP_SCHEMA;
  const mode = IS_TENANT ? "ready end mode=multi_tenant" : "ready end mode=single_db";
  mlog({ action, version, tenant: target, schema }, mode);
}

function adminTarget(tenant?: string): Target {
  const name = tenant?.trim() || CORE_TENANT_ID;
  return { pool: get_core_db(), tenant: name };
}

async function poolForTarget(
  id: string,
  action: MigrationAction,
  version: string,
  track: MigrationTrack = TENANTS_TRACK
): Promise<Target> {
  const name = id.trim();
  if (!name) throw new Error("tenant is required");
  if (is_core_tenant(name)) throw new Error("use /migration/core/... for the core database");
  mlog({ action, version, tenant: name, track }, "target tenant");
  return { pool: await get_tenant_db(name), tenant: name };
}

async function allTenantTargets(action: MigrationAction, version: string): Promise<Target[]> {
  if (!IS_TENANT) throw new Error("tenant migrations require a tenants table");
  const ids = tenant_ids();
  if (ids.length === 0) throw new Error("[migration] no tenants to run against");
  mlog({ action, version, track: TENANTS_TRACK }, `all targets tenants=${ids.join(",")}`);
  const targets: Target[] = [];
  for (const id of ids) {
    targets.push(await poolForTarget(id, action, version));
  }
  return targets;
}

async function versionsFor(
  action: MigrationAction,
  folder: string,
  track: MigrationTrack,
  tenant?: string,
  schema?: string
): Promise<string[]> {
  if (!folder) throw new Error("version is required");
  if (!isZOrderRef(folder)) return [folder];
  const versions = await loadTopVersionOrder(track, action, { tenant, schema, track });
  const ordered = action === "rollback" ? versions.toReversed() : versions;
  mlog({ action, tenant, schema, track }, `z-order ${ordered.join(" → ")}`);
  return ordered;
}

async function targetsFor(
  action: MigrationAction,
  version: string,
  track: MigrationTrack,
  tenant?: string
): Promise<Target[]> {
  if (track === ADMIN_TRACK) {
    mlog({ action, version, tenant, track }, "target admin core db");
    return [adminTarget(tenant)];
  }
  if (tenant?.trim()) return [await poolForTarget(tenant, action, version, track)];
  if (track !== TENANTS_TRACK) throw new Error(`tenant is required for folder pg/${track}`);
  return allTenantTargets(action, version);
}

function assertAdminZOrderTarget(action: MigrationAction, folder: string, track: MigrationTrack, tenant?: string): void {
  if (track !== ADMIN_TRACK || !isZOrderRef(folder)) return;
  if (tenant?.trim() && !is_core_tenant(tenant)) {
    throw new Error(`core z-order only targets core (GET /migration/core/z-order/${action})`);
  }
}

async function runTargets(
  targets: Target[],
  versions: string[],
  action: MigrationAction,
  folder: string,
  track: MigrationTrack
): Promise<TargetResult[]> {
  const results: TargetResult[] = [];
  for (const target of targets) {
    const ctx = { action, version: folder, tenant: target.tenant, schema: target.schema, track };
    mlog(ctx, `run begin versions=${versions.join(",")}`);
    const ran = await runVersionsOnPool(target.pool, versions, action, target.tenant, target.schema, track);
    mlog(ctx, "run end");
    results.push({ tenant: target.tenant, schema: target.schema, versions: ran });
  }
  return results;
}

function resultTenants(results: TargetResult[]): string[] {
  const tenants: string[] = [];
  for (const result of results) {
    tenants.push(result.tenant);
  }
  return tenants;
}

async function run(
  action: MigrationAction,
  version: string,
  tenant: string | undefined,
  track: MigrationTrack
): Promise<MigrationRunResult> {
  const folder = version.trim();
  await ready(action, folder, tenant);
  mlog({ action, version: folder, tenant, track }, tenant ? "start" : "start target=all");
  assertAdminZOrderTarget(action, folder, track, tenant);

  const targets = await targetsFor(action, folder, track, tenant);
  const versions = await versionsFor(action, folder, track, targets[0]?.tenant, targets[0]?.schema);

  let results: TargetResult[];
  try {
    results = await runTargets(targets, versions, action, folder, track);
  } catch (err) {
    merr({ action, version: folder, tenant, track }, "failed", err);
    throw err;
  }

  const tenants = resultTenants(results);
  mlog({ action, version: folder, tenant, track }, `completed targets=${tenants.join(",")}`);
  return { action, version: folder, track, versions, tenants, results };
}

export async function promote(version: string, tenant: string | undefined, track: MigrationTrack) {
  mlog({ action: "promote", version, tenant, track }, "promote begin");
  const result = await run("promote", version, tenant, track);
  mlog({ action: "promote", version, tenant, track }, "promote end");
  return result;
}

export async function rollback(version: string, tenant: string | undefined, track: MigrationTrack) {
  mlog({ action: "rollback", version, tenant, track }, "rollback begin");
  const result = await run("rollback", version, tenant, track);
  mlog({ action: "rollback", version, tenant, track }, "rollback end");
  return result;
}

/** New tenant: run every version in the tenants z-order (promote). */
export async function promoteZOrder(tenant: string) {
  const ctx = { action: "promote", version: Z_ORDER, tenant, track: TENANTS_TRACK };
  mlog(ctx, "new tenant z-order begin");
  const result = await promote(Z_ORDER, tenant, TENANTS_TRACK);
  mlog(ctx, "new tenant z-order end");
  return result;
}

export {
  ADMIN_TRACK,
  TENANTS_TRACK,
  Z_ORDER,
  catalogForFolder,
  catalogForTrack,
  isZOrderRef,
  listExtraFolders,
  listVersions,
  loadSqlOrder,
  loadTopVersionOrder,
  isSharedTrack,
  parseTrack,
  resolveTenantFolder,
  trackForTarget,
} from "./order";
export type { Catalog, MigrationAction, MigrationTrack } from "./order";
export { runMigrationOnPool } from "./runner";
