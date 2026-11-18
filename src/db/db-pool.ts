import { SQL } from "bun";
import { env_base_name } from "../config/env";
import { writeLog } from "../logging/logger";
import { APP_SCHEMA, CORE_URL, parseConnectionUrl } from "./db-url";
import { quoteIdent } from "./sql-util";

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_IDLE_TIMEOUT_SEC = 20;
const DEFAULT_CONNECT_TIMEOUT_SEC = 10;
const CORE_ID = "core";

type TenantRow = { id: string; db: string };

/** Primary / registry pool (from DB_URL). */
let corePool: SQL | null = null;

/** Per-tenant pool cache: tenantId → Bun.SQL pool. */
export const tenantPools: Map<string, SQL> = new Map();

/** Cached tenantId → raw DB URL (used to detect URL changes). */
export const tenantUrlMap: Map<string, string> = new Map();

function isCoreId(id: string): boolean {
  return String(id ?? "").trim().toLowerCase() === CORE_ID;
}

/** Bun.SQL pool; search_path is sent as a startup parameter on every connection. */
export function createPool(url: string, label: string, searchPath?: string): SQL {
  const connection = searchPath ? { search_path: quoteIdent(searchPath) } : {};
  const options = {
    url,
    max: DEFAULT_POOL_SIZE,
    idleTimeout: DEFAULT_IDLE_TIMEOUT_SEC,
    connectionTimeout: DEFAULT_CONNECT_TIMEOUT_SEC,
    connection,
  };
  const pool = new SQL(options);
  writeLog("info", `[db] pool created: ${label}`, { schema: searchPath ?? "(default)" });
  return pool;
}

function requireCoreUrl(): string {
  if (!CORE_URL) throw new Error(`${env_base_name()}_DB_URL is not set`);
  return CORE_URL;
}

export function getCorePool(): SQL {
  const url = requireCoreUrl();
  if (!corePool) corePool = createPool(url, "core", APP_SCHEMA);
  return corePool;
}

/** Load active tenantId → db URL from the tenants registry table. */
export async function loadTenantMap(): Promise<Map<string, string>> {
  const sql = getCorePool();
  const rows: TenantRow[] = await sql`SELECT id, db FROM tenants WHERE active = true`;
  writeLog("info", `[db] ${APP_SCHEMA}.tenants rows: ${rows.length}`);

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!isCoreId(row.id)) map.set(row.id, row.db);
  }
  return map;
}

function createAndCacheTenantPool(tenantId: string, rawUrl: string): SQL {
  const parsed = parseConnectionUrl(rawUrl);
  const pool = createPool(parsed.url, `tenant:${tenantId}`, parsed.searchPath);
  tenantPools.set(tenantId, pool);
  tenantUrlMap.set(tenantId, rawUrl);
  return pool;
}

async function removeTenantPool(tenantId: string): Promise<void> {
  const pool = tenantPools.get(tenantId);
  tenantPools.delete(tenantId);
  tenantUrlMap.delete(tenantId);
  if (!pool) return;
  await pool.close();
  writeLog("info", `[db] tenant pool removed, tenant: ${tenantId}`);
}

/** Return cached tenant pool, or create one from the registry. */
export async function getOrCreateTenantPool(tenantId: string): Promise<SQL> {
  if (isCoreId(tenantId)) return getCorePool();

  const cached = tenantPools.get(tenantId);
  if (cached) return cached;

  const tenantMap = await loadTenantMap();
  const rawUrl = tenantMap.get(tenantId);
  if (!rawUrl) throw new Error(`No PostgreSQL URL found for tenant: ${tenantId}`);

  return createAndCacheTenantPool(tenantId, rawUrl);
}

async function removeMissingTenants(nextMap: Map<string, string>): Promise<void> {
  for (const tenantId of Array.from(tenantPools.keys())) {
    if (!nextMap.has(tenantId)) await removeTenantPool(tenantId);
  }
}

/**
 * Reload tenants table and sync pools:
 * add new active tenants, recreate on URL change, drop inactive/deleted.
 * Returns ids of newly added tenants.
 */
export async function syncTenantPools(): Promise<string[]> {
  writeLog("info", "[db] syncing tenant pools from registry...");
  const nextMap = await loadTenantMap();
  const added: string[] = [];

  await removeMissingTenants(nextMap);

  for (const [tenantId, rawUrl] of nextMap) {
    const isNew = !tenantUrlMap.has(tenantId);
    const unchanged = tenantUrlMap.get(tenantId) === rawUrl && tenantPools.has(tenantId);
    if (unchanged) continue;
    if (tenantPools.has(tenantId)) await removeTenantPool(tenantId);
    createAndCacheTenantPool(tenantId, rawUrl);
    if (isNew) added.push(tenantId);
  }

  const syncFields = { count: tenantPools.size, ids: tenantIds(), added };
  writeLog("info", "[db] tenant sync done", syncFields);
  return added;
}

export async function refreshTenantPools(): Promise<void> {
  await syncTenantPools();
}

export async function closeAllPools(): Promise<void> {
  const pools: SQL[] = Array.from(tenantPools.values());
  if (corePool) pools.push(corePool);
  for (const pool of pools) {
    await pool.close();
  }
  corePool = null;
  tenantPools.clear();
  tenantUrlMap.clear();
}

export function tenantIds(): string[] {
  return Array.from(tenantPools.keys());
}
