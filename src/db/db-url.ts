import { env } from "../config/env";

export type ParsedConnectionUrl = { url: string; searchPath: string };

const DEFAULT_SCHEMA = "public";

function extractSearchPath(raw: string): string | undefined {
  const optionsMatch = raw.match(/[?&]options=([^&]*)/i);
  if (!optionsMatch?.[1]) return undefined;
  const options = decodeURIComponent(optionsMatch[1].replace(/^['"]|['"]$/g, "").trim());
  const searchPathMatch = options.match(/search_path\s*=\s*([^\s&'"]+)/i);
  return searchPathMatch?.[1];
}

function stripOptionsParam(match: string): string {
  return match.startsWith("?") ? "?" : "";
}

/**
 * Split a postgres URL into a clean URL (without `options=`) and its schema
 * from `options=-c search_path=SCHEMA` (defaults to public).
 * The schema is applied as a Bun.SQL `connection.search_path` startup parameter.
 */
export function parseConnectionUrl(raw: string): ParsedConnectionUrl {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return { url: "", searchPath: DEFAULT_SCHEMA };

  const searchPath = extractSearchPath(trimmed) || DEFAULT_SCHEMA;
  const url = trimmed
    .replace(/[?&]options=[^&]*/gi, stripOptionsParam)
    .replace(/\?&/, "?")
    .replace(/\?$/, "");

  return { url, searchPath };
}

const parsed = parseConnectionUrl(env("DB_URL") || "");

/** Clean core connection string (`${BASE_NAME}_DB_URL`, options stripped). */
export const CORE_URL = parsed.url;

/** App schema from DB_URL options search_path (default public). */
export const APP_SCHEMA = parsed.searchPath;
