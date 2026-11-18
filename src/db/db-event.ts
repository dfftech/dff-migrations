import type { SQL } from "bun";
import { merr, mlog } from "../migration-runner/log";
import { writeLog } from "../logging/logger";
import { getCorePool, syncTenantPools } from "./db-pool";
import { APP_SCHEMA } from "./db-url";
import { quoteIdent } from "./sql-util";

const CHANNEL = "tenant_change";
const TRIGGER_NAME = "tenants_notify_trigger";
const FUNCTION_NAME = "notify_tenant_change";
const TX_PREFIX = "####";

type NotifyPayload = { op?: string; id?: string; active?: boolean };

let subscription: SQL.ListenSubscription | null = null;

/** Log-safe notify summary — never includes db URL. */
function safeNotifySummary(payload: string): string {
  if (!payload) return "(no payload)";
  try {
    const parsed = JSON.parse(payload) as NotifyPayload;
    const summary = { op: parsed.op, id: parsed.id, active: parsed.active };
    return JSON.stringify(summary);
  } catch {
    return "(unparsed)";
  }
}

async function triggerExists(sql: SQL): Promise<boolean> {
  const rows = await sql`
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${APP_SCHEMA}
      AND c.relname = 'tenants'
      AND t.tgname = ${TRIGGER_NAME}
      AND NOT t.tgisinternal
    LIMIT 1
  `;
  return rows.length > 0;
}

function notifyFunctionSql(fn: string): string {
  return `
    CREATE OR REPLACE FUNCTION ${fn}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      payload text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        payload := json_build_object('op', TG_OP, 'id', OLD.id)::text;
      ELSE
        payload := json_build_object('op', TG_OP, 'id', NEW.id, 'active', NEW.active)::text;
      END IF;
      PERFORM pg_notify('${CHANNEL}', payload);
      RETURN COALESCE(NEW, OLD);
    END;
    $fn$;
  `;
}

/** Ensure notify function + AFTER INSERT/UPDATE/DELETE trigger on tenants (one transaction). */
async function applyTriggerDdl(fn: string, table: string, tx: SQL): Promise<void> {
  writeLog("info", `${TX_PREFIX} BEGIN TRANSACTION [db-event] tenants notify trigger`);
  await tx.unsafe(notifyFunctionSql(fn));
  if (await triggerExists(tx)) {
    writeLog("info", `[db-event] trigger "${TRIGGER_NAME}" already exists on ${APP_SCHEMA}.tenants`);
    return;
  }
  writeLog("info", `[db-event] creating trigger "${TRIGGER_NAME}" on ${APP_SCHEMA}.tenants`);
  await tx.unsafe(
    `CREATE TRIGGER ${quoteIdent(TRIGGER_NAME)} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE PROCEDURE ${fn}()`
  );
}

export async function ensureTenantChangeTrigger(): Promise<void> {
  const schema = quoteIdent(APP_SCHEMA);
  const fn = `${schema}.${quoteIdent(FUNCTION_NAME)}`;
  const table = `${schema}.${quoteIdent("tenants")}`;
  try {
    await getCorePool().begin(applyTriggerDdl.bind(null, fn, table));
  } catch (err) {
    writeLog("error", `${TX_PREFIX} ROLLBACK [db-event] tenants notify trigger`, { error: err });
    throw err;
  }
  writeLog("info", `${TX_PREFIX} COMMIT [db-event] tenants notify trigger`);
}

/** Sync pools; run tenants z-order promote for every newly added tenant. */
async function handleTenantChange(): Promise<void> {
  const added = await syncTenantPools();
  if (added.length === 0) {
    mlog({ action: "promote", version: "z-order" }, "tenant change: no new tenants");
    return;
  }
  const runner = await import("../migration-runner");
  for (const tenantId of added) {
    mlog({ action: "promote", version: "z-order", tenant: tenantId, phase: "begin" });
    await runner.promoteZOrder(tenantId);
    mlog({ action: "promote", version: "z-order", tenant: tenantId, phase: "end" });
  }
}

function logTenantChangeFailure(err: unknown): void {
  merr({ action: "promote", version: "z-order", phase: "fail" }, "tenant change handler failed", err);
}

function onTenantNotify(payload: string): void {
  writeLog("info", `[db-event] tenants table changed: ${safeNotifySummary(payload)}`);
  handleTenantChange().catch(logTenantChangeFailure);
}

function onTenantListen(): void {
  writeLog("info", `[db-event] listening on channel "${CHANNEL}"`);
}

/** Bun.SQL LISTEN (dedicated connection, auto-reconnect + re-subscribe). */
export async function initTenantEvents(): Promise<void> {
  if (subscription) return;
  await ensureTenantChangeTrigger();
  subscription = await getCorePool().listen(CHANNEL, onTenantNotify, onTenantListen);
}

export async function stopTenantEvents(): Promise<void> {
  if (!subscription) return;
  const active = subscription;
  subscription = null;
  await active.unlisten();
  writeLog("info", "[db-event] listener stopped");
}
