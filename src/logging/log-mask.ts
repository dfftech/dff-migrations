import { env } from "../config/env";

const MASK = "xxx-xxx-xxxx";
const DEFAULT_MASK_KEYS = "email,mobile,tel_code,telcode,phone,password,token,authorization,pic,secret";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

function maskKeySet(): Set<string> {
  const raw = env("LOG_MASK_KEYS") || DEFAULT_MASK_KEYS;
  const keys = new Set<string>();
  for (const part of raw.split(/[,|\s]+/)) {
    const normalized = normalizeKey(part.trim());
    if (normalized) keys.add(normalized);
  }
  return keys;
}

function keyTokens(key: string): string[] {
  const parts = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").split(/[-_]+/);
  const tokens: string[] = [];
  for (const part of parts) {
    if (part) tokens.push(part.toLowerCase());
  }
  return tokens;
}

function shouldMaskKey(key: string, keys: Set<string>): boolean {
  const normalized = normalizeKey(key);
  if (keys.has(normalized)) return true;
  for (const token of keyTokens(key)) {
    if (keys.has(token)) return true;
  }
  for (const maskKey of keys) {
    if (maskKey && normalized.includes(maskKey)) return true;
  }
  return false;
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function maskValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return value;
  return MASK;
}

function walkArray(items: unknown[], keys: Set<string>, seen: WeakSet<object>): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    out.push(walk(item, keys, seen));
  }
  return out;
}

function walkObject(value: Record<string, unknown>, keys: Set<string>, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = shouldMaskKey(key, keys) && isPrimitive(child) ? maskValue(child) : walk(child, keys, seen);
  }
  return out;
}

function walk(value: unknown, keys: Set<string>, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return MASK;
  seen.add(value);
  if (Array.isArray(value)) return walkArray(value, keys, seen);
  return walkObject(value as Record<string, unknown>, keys, seen);
}

/** Clone log payload and mask values whose keys are in LOG_MASK_KEYS (env). */
export function maskLogData<T>(data: T): T {
  if (data === null || data === undefined || typeof data !== "object") return data;
  return walk(data, maskKeySet(), new WeakSet()) as T;
}
