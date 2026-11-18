import { join } from "node:path";
import { IS_TENANT, is_core_tenant } from "../db/db-connection";
import { MIGRATION_CONTENT_DIR } from "../git/clone-repo";
import { fileExists, isDirectory, listChildDirs, listChildNames } from "../utils/fs-util";
import { mlog, type MigrationLog } from "./log";

export type MigrationAction = "promote" | "rollback";
export const Z_ORDER = "z-order";
const Z_ORDER_FILE = "z-order.yaml";
const ACTIONS: MigrationAction[] = ["promote", "rollback"];

/**
 * Repo layout: .migration/pg/{folder}/{version}/{action}.
 *  - "admin"   → pg/core     (core DB)
 *  - "tenants" → pg/tenants  (shared by every tenant)
 *  - any other → pg/{tenant} (per-tenant override folder, e.g. "local", "dtf")
 */
export type MigrationTrack = "admin" | "tenants" | (string & {});
export const ADMIN_TRACK: MigrationTrack = "admin";
export const TENANTS_TRACK: MigrationTrack = "tenants";

export type Catalog = { versions: string[]; actions: MigrationAction[] };

/** Physical folder name on disk for a track (repo uses "core", not "admin"). */
const TRACK_FOLDER: Record<string, string> = {
  admin: "core",
  tenants: "tenants",
};

/** Everything else under MIGRATION_CONTENT_DIR is a per-tenant override folder. */
const RESERVED_FOLDERS = new Set(Object.values(TRACK_FOLDER));

/** admin → core / single-db; tenants → every other tenant id. */
export function trackForTarget(tenant?: string): MigrationTrack {
  if (!IS_TENANT) return ADMIN_TRACK;
  if (tenant?.trim() && is_core_tenant(tenant)) return ADMIN_TRACK;
  return TENANTS_TRACK;
}

/** True for the two shared tracks (core / tenants), false for a per-tenant folder. */
export function isSharedTrack(track: MigrationTrack): boolean {
  return track === ADMIN_TRACK || track === TENANTS_TRACK;
}

/**
 * Per-tenant override folder for a tenant id (pg/{tenant}), matched
 * case-insensitively against the folders on disk. Throws when there is none.
 */
export async function resolveTenantFolder(tenant: string): Promise<MigrationTrack> {
  const wanted = tenant.trim().toLowerCase();
  for (const folder of await listExtraFolders()) {
    if (folder.toLowerCase() === wanted && (await isDirectory(folderDir(folder)))) return folder;
  }
  throw new Error(
    `[migration] no tenant folder pg/${tenant} — use /migration/tenants/:version/:action/${tenant} to run the shared tenants folder`
  );
}

export function parseTrack(raw: string): MigrationTrack {
  const track = String(raw ?? "").trim().toLowerCase();
  if (track === ADMIN_TRACK || track === TENANTS_TRACK) return track;
  throw new Error(`Invalid migration track "${raw}" (use admin or tenants)`);
}

/** True when the version refers to top-level z-order.yaml, not a version folder. */
export function isZOrderRef(version: string): boolean {
  return version.trim().toLowerCase().replace(/_/g, "-") === Z_ORDER;
}

/**
 * Parse a flat YAML list ("- 0001"). Hand-parsed on purpose: a YAML parser
 * would turn "- 0001" into the number 1 and lose the folder name.
 */
function parseYamlNameList(raw: string, path: string): string[] {
  const names: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^-\s+(.+)$/);
    if (match?.[1]) names.push(match[1].trim());
  }
  if (names.length === 0) throw new Error(`[migration] ${path} has no entries`);
  return names;
}

async function readYamlList(path: string): Promise<string[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`[migration] missing ${path}`);
  return parseYamlNameList(await file.text(), path);
}

function assertVersion(version: string): string {
  const name = version.trim();
  if (!/^[0-9A-Za-z._-]+$/.test(name)) throw new Error(`Invalid migration version: ${version}`);
  return name;
}

function assertVersions(versions: string[]): string[] {
  const out: string[] = [];
  for (const version of versions) {
    out.push(assertVersion(version));
  }
  return out;
}

function trackDir(track: MigrationTrack): string {
  return join(MIGRATION_CONTENT_DIR, TRACK_FOLDER[track] ?? track);
}

function folderDir(folder: string): string {
  return join(MIGRATION_CONTENT_DIR, folder);
}

async function hasActionDir(dir: string): Promise<boolean> {
  const kids = await listChildNames(dir);
  return kids.includes("promote") || kids.includes("rollback");
}

async function listVersionsInDir(dir: string): Promise<string[]> {
  const versions: string[] = [];
  for (const name of await listChildDirs(dir)) {
    if (await hasActionDir(join(dir, name))) versions.push(name);
  }
  return versions;
}

export function listVersions(track: MigrationTrack): Promise<string[]> {
  return listVersionsInDir(trackDir(track));
}

function versionHasActionInDir(dir: string, version: string, action: MigrationAction): Promise<boolean> {
  return fileExists(join(dir, version, action, Z_ORDER_FILE));
}

function versionHasAction(track: MigrationTrack, version: string, action: MigrationAction): Promise<boolean> {
  return versionHasActionInDir(trackDir(track), version, action);
}

async function filterVersionsWithAction(
  track: MigrationTrack,
  versions: string[],
  action: MigrationAction
): Promise<string[]> {
  const out: string[] = [];
  for (const version of versions) {
    if (await versionHasAction(track, version, action)) out.push(version);
  }
  return out;
}

async function dirHasZOrderFile(dir: string): Promise<boolean> {
  if (await fileExists(join(dir, Z_ORDER_FILE))) return true;
  return fileExists(join(MIGRATION_CONTENT_DIR, Z_ORDER_FILE));
}

async function anyVersionHasAction(dir: string, versions: string[], action: MigrationAction): Promise<boolean> {
  for (const version of versions) {
    if (await versionHasActionInDir(dir, version, action)) return true;
  }
  return false;
}

async function catalogForDir(dir: string): Promise<Catalog> {
  const versions = await listVersionsInDir(dir);
  const actions: MigrationAction[] = [];
  for (const action of ACTIONS) {
    if (await anyVersionHasAction(dir, versions, action)) actions.push(action);
  }
  if (actions.length > 0 && (await dirHasZOrderFile(dir))) versions.push(Z_ORDER);
  return { versions, actions };
}

/** Folder-driven catalog for a track: versions, supported actions, z-order. */
export function catalogForTrack(track: MigrationTrack): Promise<Catalog> {
  return catalogForDir(trackDir(track));
}

/** Folder-driven catalog for a per-tenant override folder (e.g. "local", "dtf"). */
export function catalogForFolder(folder: string): Promise<Catalog> {
  return catalogForDir(folderDir(folder));
}

/** Top-level folders under MIGRATION_CONTENT_DIR that aren't "core"/"tenants". */
export async function listExtraFolders(): Promise<string[]> {
  const out: string[] = [];
  for (const name of await listChildDirs(MIGRATION_CONTENT_DIR)) {
    if (!RESERVED_FOLDERS.has(name)) out.push(name);
  }
  return out;
}

async function resolveTopVersions(
  track: MigrationTrack,
  action: MigrationAction
): Promise<{ versions: string[]; source: string }> {
  const trackPath = join(trackDir(track), Z_ORDER_FILE);
  const rootPath = join(MIGRATION_CONTENT_DIR, Z_ORDER_FILE);

  if (await fileExists(trackPath)) {
    const versions = assertVersions(await readYamlList(trackPath));
    return { versions, source: trackPath };
  }
  if (await fileExists(rootPath)) {
    const listed = assertVersions(await readYamlList(rootPath));
    const inTrack = await filterVersionsWithAction(track, listed, action);
    if (inTrack.length > 0) return { versions: inTrack, source: rootPath };
  }
  const scanned = await filterVersionsWithAction(track, await listVersions(track), action);
  return { versions: scanned, source: `${trackDir(track)} (scan)` };
}

async function missingActionVersions(
  track: MigrationTrack,
  versions: string[],
  action: MigrationAction
): Promise<string[]> {
  const missing: string[] = [];
  for (const version of versions) {
    if (!(await versionHasAction(track, version, action))) missing.push(version);
  }
  return missing;
}

/** Track (or root) z-order.yaml — version folder order for that track. */
export async function loadTopVersionOrder(
  track: MigrationTrack,
  action: MigrationAction,
  ctx?: MigrationLog
): Promise<string[]> {
  const { versions, source } = await resolveTopVersions(track, action);
  if (versions.length === 0) throw new Error(`[migration] no ${action} versions under ${trackDir(track)}`);

  mlog({ ...ctx, action, track }, `top z-order.yaml ${source} ${versions.join(" → ")}`);

  const missing = await missingActionVersions(track, versions, action);
  if (missing.length > 0) {
    throw new Error(
      `[migration] ${action} z-order lists versions with no ${track}/{version}/${action}/z-order.yaml: ${missing.join(", ")}`
    );
  }
  return versions;
}

export function versionActionDir(track: MigrationTrack, version: string, action: MigrationAction): string {
  return join(trackDir(track), assertVersion(version), action);
}

/** Per-version {track}/{version}/{action}/z-order.yaml — SQL file order. */
export async function loadSqlOrder(
  track: MigrationTrack,
  version: string,
  action: MigrationAction,
  ctx?: MigrationLog
): Promise<string[]> {
  const orderPath = join(versionActionDir(track, version, action), Z_ORDER_FILE);
  if (!(await fileExists(orderPath))) {
    const available = await listVersions(track);
    const hint = available.length > 0 ? ` (versions: ${available.join(", ")})` : "";
    throw new Error(`[migration] ${action} track=${track} version=${version} missing ${orderPath}${hint}`);
  }
  const names = await readYamlList(orderPath);
  mlog({ ...ctx, action, version, track }, `file order ${names.join(" → ")}`);
  return names;
}

/** Absolute path of {name}.sql inside a version/action folder. */
export function sqlFilePath(track: MigrationTrack, version: string, action: MigrationAction, name: string): string {
  return join(versionActionDir(track, version, action), `${name}.sql`);
}
