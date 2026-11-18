import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionInfo } from "dff-util";
import type { AppLogger } from "../logging/kafka-logger";

/** Per-request state (replaces Encore's currentRequest().middlewareData). */
export type RequestContext = {
  requestId: string;
  traceId?: string;
  tenantId?: string;
  token?: string;
  sessionUser: SessionInfo;
  logger: AppLogger;
  method: string;
  path: string;
  query: URLSearchParams;
  startedAt: number;
};

export const requestStore = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestStore.getStore();
}
