import type { ResponseType } from "dff-util";
import { request_id } from "../utils/app-util";

/** Error carrying an HTTP status (400 bad input, 404 not found…). */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Status from an HttpError (or any error with a numeric 4xx/5xx `status`), else fallback. */
export function errorStatus(err: unknown, fallback = 500): number {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 600 ? status : fallback;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "unknown error");
}

function responseMeta() {
  return { requestId: request_id(), timestamp: new Date().toISOString() };
}

export function okResponse(data: unknown): ResponseType {
  return { status: 200, data, meta: responseMeta() };
}

export function failResponse(err: unknown, status = errorStatus(err)): ResponseType {
  const error = { message: errorMessage(err) };
  return { status, error, meta: responseMeta() };
}

/** ResponseType → JSON Response; HTTP status mirrors body.status. */
export function sendResponse(body: ResponseType): Response {
  const status = Number(body.status) || 200;
  const init = { status };
  return Response.json(body, init);
}
