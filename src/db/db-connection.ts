import type { SQL } from "bun";
import { env_base_name } from "../config/env";
import { writeLog } from "../logging/logger";
import { setMigrationLogKind } from "../migration-runner/log";
import { initTenantEvents, stopTenantEvents } from "./db-event";
import { closeAllPools, getCorePool, getOrCreateTenantPool, refreshTenantPools, tenantIds } from "./db-pool";
import { APP_SCHEMA, CORE_URL } from "./db-url";

/**
 * Set once during init_tenants_db().
 * true  → {APP_SCHEMA}.tenants exists (multi-tenant)
 * false → no tenants table (single-tenant)
 */
export let IS_TENANT = false;

/** Reserved tenant id: always served by the base DB (DB_URL). */
export const CORE_TENANT_ID = "core";

let initPromise: Promise<void> | null = null;

export function is_core_tenant(tenantId?: string): boolean {
  return String(tenantId ?? "").trim().toLowerCase() === CORE_TENANT_ID;
}

/** Bun.SQL pool for the primary DB (registry / single-tenant DB). */
export function get_core_db(): SQL {
  return getCorePool();
}

/** Bun.SQL pool for a tenant (multi-tenant only). No tenants table → core DB. */
export async function get_tenant_db(tenantId: string): Promise<SQL> {
  if (is_core_tenant(tenantId) || !IS_TENANT) return get_core_db();
  return getOrCreateTenantPool(tenantId);
}

export async function refresh_tenant_pools(): Promise<void> {
  if (!IS_TENANT) {
    writeLog("info", "[db] single-tenant: skip tenant pool refresh");
    return;
  }
  await refreshTenantPools();
}

async function detectMultiTenant(): Promise<boolean> {
  const sql = getCorePool();
  const rows = await sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = ${APP_SCHEMA}
      AND table_name = 'tenants'
    LIMIT 1
  `;
  const multi = rows.length > 0;
  const mode = multi ? "multi_tenant" : "single_tenant";
  writeLog("info", `[db] architecture: ${mode}`, { schema: APP_SCHEMA, tenantsTable: multi });
  return multi;
}

async function pingCoreDb(): Promise<void> {
  const sql = getCorePool();
  const start = performance.now();
  const rows = await sql`SELECT 1 AS ok`;
  const ms = Math.round(performance.now() - start);
  const ok = rows[0]?.ok === 1;
  writeLog("info", `[db] core DB ping: ${ok ? "ok" : "unexpected"} in ${ms} ms`);
  if (!ok) throw new Error("core DB ping failed: expected row with ok=1");
}

async function runInit(): Promise<void> {
  if (!CORE_URL) {
    writeLog("warn", `DB init skip: ${env_base_name()}_DB_URL is not set (BASE_NAME=${env_base_name()})`);
    return;
  }
  writeLog("info", `[db] init_tenants_db running, schema: ${APP_SCHEMA}`);
  await pingCoreDb();

  IS_TENANT = await detectMultiTenant();
  setMigrationLogKind(IS_TENANT ? "tenant" : "schema");

  if (IS_TENANT) {
    await refreshTenantPools();
    await initTenantEvents();
  }
  writeLog("info", ":---------DB initialization completed---------:", { IS_TENANT });
}

function resetInit(err: unknown): never {
  initPromise = null;
  throw err;
}

/**
 * Connect, set IS_TENANT once, warm tenant pools when multi-tenant,
 * and start the tenants-table LISTEN. Retries on next call after a failure.
 */
export function init_tenants_db(): Promise<void> {
  if (!initPromise) initPromise = runInit().catch(resetInit);
  return initPromise;
}

export function ensure_tenants_db_init(): Promise<void> {
  return init_tenants_db();
}

export async function close_db_pools(): Promise<void> {
  await stopTenantEvents();
  await closeAllPools();
  IS_TENANT = false;
  initPromise = null;
}

export function tenant_ids(): string[] {
  return tenantIds();
}

/** @deprecated misspelled legacy name — use tenant_ids(). */
export const tentant_ids = tenant_ids;

export { getCorePool } from "./db-pool";
export { APP_SCHEMA } from "./db-url";
