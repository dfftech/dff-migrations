import type { SessionInfo } from "dff-util";
import type { SQL } from "bun";
import { currentContext } from "../context/request-context";
import { currentAppLogger, type AppLogger } from "../logging/kafka-logger";
import { get_core_db, get_tenant_db } from "../db/db-connection";

export { env, env_base_name } from "../config/env";

const UNKNOWN_USER: SessionInfo = { id: "unknown", roles: [], key: "", createdAt: "" };

export type SessionMeta = {
  logger: AppLogger;
  session_user: SessionInfo;
  request_id: string;
  token?: string;
  tenant_id?: string;
};

export function session_meta(): SessionMeta {
  const context = currentContext();
  return {
    logger: currentAppLogger(),
    session_user: context?.sessionUser ?? UNKNOWN_USER,
    request_id: context?.requestId ?? "-",
    token: context?.token,
    tenant_id: context?.tenantId,
  };
}

export function logger(): AppLogger {
  return currentAppLogger();
}

export function session_user(): SessionInfo {
  return currentContext()?.sessionUser ?? UNKNOWN_USER;
}

export function request_id(): string {
  return currentContext()?.requestId ?? "-";
}

export function token(): string | undefined {
  return currentContext()?.token;
}

export function tenant_id(): string | undefined {
  return currentContext()?.tenantId;
}

export function query_params(): Record<string, string> {
  const query = currentContext()?.query;
  if (!query) return {};
  return Object.fromEntries(query);
}

export function core_db(): SQL {
  return get_core_db();
}

/** DB for the request tenant (core when no tenant / unknown tenant). */
export async function session_db(): Promise<SQL> {
  return get_db(tenant_id());
}

export async function get_db(key?: string): Promise<SQL> {
  if (!key) return get_core_db();
  try {
    return await get_tenant_db(key);
  } catch {
    return get_core_db();
  }
}
