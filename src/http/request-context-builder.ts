import { JwtDecode, type SessionInfo } from "dff-util";
import type { RequestContext } from "../context/request-context";
import { AppLogger } from "../logging/kafka-logger";

const HEALTH_PATH = /^\/health\/([^/]+)$/;
const MIGRATION_TENANT_PATH = /^\/migration\/[^/]+\/[^/]+\/(?:promote|rollback)\/([^/]+)$/;
const ALL_TENANTS = "all";
const EMPTY_HEADER_VALUES = new Set(["", "undefined", "null"]);

/** Header value, treating "undefined"/"null" (sent by some clients) as absent. */
function headerValue(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim();
  if (!value || EMPTY_HEADER_VALUES.has(value.toLowerCase())) return undefined;
  return value;
}

function extractToken(authorization: string | null): string | undefined {
  if (!authorization) return undefined;
  const token = authorization.replace(/bearer|jwt/i, "").trim();
  return token || undefined;
}

function decodeSession(token: string | undefined): SessionInfo {
  const unknownUser: SessionInfo = { id: "unknown", roles: [], key: "", createdAt: "" };
  if (!token) return unknownUser;
  try {
    return JwtDecode(token) as SessionInfo;
  } catch {
    return unknownUser;
  }
}

function decodeSegment(segment: string | undefined): string | undefined {
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Tenant from the URL: /health/:id or /migration/:track/:version/:action/:tenant. */
export function tenantFromPath(path: string): string | undefined {
  const health = decodeSegment(path.match(HEALTH_PATH)?.[1]);
  if (health) return health;
  const migrationTenant = decodeSegment(path.match(MIGRATION_TENANT_PATH)?.[1]);
  if (migrationTenant && migrationTenant.toLowerCase() !== ALL_TENANTS) return migrationTenant;
  return undefined;
}

/** Build the per-request context (logging + tenant "middleware" state). */
export function buildRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  const headers = request.headers;
  const requestId = headerValue(headers, "request-id") || crypto.randomUUID();
  const traceId = headerValue(headers, "x-trace-id") || headerValue(headers, "traceparent");
  const tenantId = tenantFromPath(url.pathname) || headerValue(headers, "x-tenant-id");
  const token = extractToken(headerValue(headers, "authorization") ?? null);
  const sessionUser = decodeSession(token);
  sessionUser.requestId = requestId;

  const loggerContext = { requestId, traceId, sessionUserId: sessionUser.id, tenantId };
  return {
    requestId,
    traceId,
    tenantId,
    token,
    sessionUser,
    logger: new AppLogger(loggerContext),
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    startedAt: performance.now(),
  };
}
