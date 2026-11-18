import { app } from "../app";
import { requestStore, type RequestContext } from "../context/request-context";
import { errorMessage } from "./response";
import { buildRequestContext } from "./request-context-builder";

function durationSeconds(context: RequestContext): number {
  return (performance.now() - context.startedAt) / 1000;
}

/** Copy the response if its headers are immutable, then add tracing headers. */
function withTracingHeaders(response: Response, context: RequestContext): Response {
  let out = response;
  try {
    out.headers.set("request-id", context.requestId);
  } catch {
    out = new Response(response.body, response);
    out.headers.set("request-id", context.requestId);
  }
  out.headers.set("session-user-id", context.sessionUser.id);
  if (context.traceId) out.headers.set("x-trace-id", context.traceId);
  return out;
}

function unexpectedFailure(context: RequestContext, err: unknown): Response {
  const error = { message: errorMessage(err) };
  const meta = { requestId: context.requestId, timestamp: new Date().toISOString() };
  const body = { status: 500, error, meta };
  const init = { status: 500 };
  return Response.json(body, init);
}

/** Runs inside the request's AsyncLocalStorage scope. */
async function processRequest(request: Request): Promise<Response> {
  const context = requestStore.getStore() as RequestContext;
  const startFields = { method: context.method, path: context.path };
  await context.logger.info("Request started", startFields);

  let response: Response;
  try {
    response = await app.fetch(request);
  } catch (err) {
    response = unexpectedFailure(context, err);
  }

  const doneFields = { status: response.status, duration_sec: durationSeconds(context) };
  await context.logger.info("Request completed", doneFields);
  return withTracingHeaders(response, context);
}

/** Bun.serve fetch handler: request context + logging around the Elysia app. */
export function handleRequest(request: Request): Promise<Response> {
  const context = buildRequestContext(request);
  return requestStore.run(context, processRequest, request);
}
