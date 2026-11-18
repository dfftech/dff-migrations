import { emitAppLog } from "../logging/kafka-logger";
import type { MigrationAction } from "./order";

export type MigrationLog = {
  action?: MigrationAction | string;
  version?: string;
  tenant?: string;
  schema?: string;
  track?: string;
  file?: string;
  phase?: "begin" | "end" | "fail" | "skip";
};

/** "tenant" when {schema}.tenants exists, "schema" for single-db. */
let targetKind: "tenant" | "schema" = "tenant";

export function setMigrationLogKind(kind: "tenant" | "schema"): void {
  targetKind = kind;
}

function targetName(ctx: MigrationLog): string {
  if (targetKind === "schema") return ctx.schema || ctx.tenant || "all";
  return ctx.tenant || ctx.schema || "all";
}

function bracket(ctx: MigrationLog): string {
  const action = ctx.action ?? "migrate";
  const version = ctx.version?.trim();
  const name = targetName(ctx);
  const inner = version ? `${action} ${version} ${name}` : `${action} ${name}`;
  return `[${inner}]`;
}

/** First non-empty string in rest is treated as the failing SQL query text. */
function findQuery(rest: unknown[]): string | undefined {
  for (const item of rest) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return undefined;
}

function findError(rest: unknown[]): Error | undefined {
  for (const item of rest) {
    if (item instanceof Error) return item;
  }
  return undefined;
}

function fields(ctx: MigrationLog, rest: unknown[]): string {
  const parts = [bracket(ctx)];
  if (ctx.file) parts.push(`file=${ctx.file}`);
  if (ctx.phase) parts.push(ctx.phase);
  const query = findQuery(rest);
  if (query) parts.push(`query=${JSON.stringify(query)}`);
  return parts.join(" ");
}

function payload(ctx: MigrationLog, rest: unknown[]): Record<string, unknown> {
  const data: Record<string, unknown> = {
    source: "migration",
    action: ctx.action,
    version: ctx.version,
    tenant: ctx.tenant,
    schema: ctx.schema,
    track: ctx.track,
    target: targetName(ctx),
    file: ctx.file,
    phase: ctx.phase,
  };
  const err = findError(rest);
  if (err) {
    data.error = err.message;
    data.error_stack = err.stack;
  }
  const query = findQuery(rest);
  if (query) data.query = query;
  return data;
}

function line(ctx: MigrationLog, message: string, rest: unknown[]): string {
  const extra = message ? ` ${message}` : "";
  return `[migration] ${fields(ctx, rest)}${extra}`.trim();
}

export function mlog(ctx: MigrationLog, message = "", ...rest: unknown[]): void {
  emitAppLog("info", line(ctx, message, rest), payload(ctx, rest));
}

/** Transaction marker log: "#### BEGIN TRANSACTION [promote 0000 t1] …" (error level when err given). */
export function mtx(ctx: MigrationLog, marker: string, detail = "", err?: unknown): void {
  const rest = err ? [err] : [];
  const message = `#### ${marker} ${bracket(ctx)}${detail ? ` ${detail}` : ""}`;
  emitAppLog(err ? "error" : "info", message, payload(ctx, rest));
}

export function merr(ctx: MigrationLog, message = "", ...rest: unknown[]): void {
  emitAppLog("error", line(ctx, message, rest), payload(ctx, rest));
}
