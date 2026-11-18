import { IS_PRODUCTION } from "../config/env";

export type LogLevel = "info" | "error" | "warn" | "debug";
export type LogFields = Record<string, unknown>;

/** JSON.stringify replacer: keeps Error details and BigInt values readable. */
function logReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    const errorInfo = { message: value.message, stack: value.stack };
    return errorInfo;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function formatJson(level: LogLevel, message: string, fields: LogFields): string {
  const entry = { level, time: new Date().toISOString(), message, ...fields };
  return JSON.stringify(entry, logReplacer);
}

function formatPretty(level: LogLevel, message: string, fields: LogFields): string {
  const time = new Date().toISOString();
  const hasFields = Object.keys(fields).length > 0;
  const extra = hasFields ? " " + JSON.stringify(fields, logReplacer) : "";
  return `${time} ${level.toUpperCase().padEnd(5)} ${message}${extra}`;
}

/** Structured console log (JSON in production, single-line pretty otherwise). */
export function writeLog(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = IS_PRODUCTION ? formatJson(level, message, fields) : formatPretty(level, message, fields);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
