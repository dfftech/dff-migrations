import type { ResponseType } from "dff-util";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_DIR, refresh_repo } from "../../git/clone-repo";
import { HttpError, failResponse, okResponse } from "../../http/response";
import { merr, mlog } from "../../migration-runner/log";
import { isDirectory } from "../../utils/fs-util";

const JSON_EXT = ".json";

type JsonObject = Record<string, unknown>;

/** Walk state while resolving a dotted path. */
type ResolveState = { dir: string; value: unknown; resolvedAsValue: boolean };

async function readJsonFile(path: string): Promise<unknown> {
  return Bun.file(path).json();
}

async function readNamespace(dir: string, fileName: string, out: JsonObject): Promise<void> {
  const path = join(dir, fileName);
  try {
    out[fileName.slice(0, -JSON_EXT.length)] = await readJsonFile(path);
  } catch (err) {
    merr({ phase: "fail" }, `failed to parse ${path}`, err);
  }
}

async function mergeSubDirs(dir: string, subDirs: string[], out: JsonObject): Promise<void> {
  for (const name of subDirs) {
    const merged = await mergeJsonFilesInDir(join(dir, name));
    if (Object.keys(merged).length > 0) out[name] = merged;
  }
}

/**
 * Merge every *.json directly under dir into { namespace: data }.
 * No json files but sub-folders (e.g. locales → en-US/, fr-FR/) → merge each
 * sub-folder recursively, keyed by folder name.
 */
async function mergeJsonFilesInDir(dir: string): Promise<JsonObject> {
  const out: JsonObject = {};
  const subDirs: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) subDirs.push(entry.name);
    else if (entry.isFile() && entry.name.endsWith(JSON_EXT)) await readNamespace(dir, entry.name, out);
  }

  if (Object.keys(out).length === 0) await mergeSubDirs(dir, subDirs, out);
  return out;
}

function isEmptyData(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "object") return Object.keys(value).length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function splitPath(dataPath: string): string[] {
  const segments: string[] = [];
  for (const part of dataPath.split(".")) {
    const trimmed = part.trim();
    if (trimmed) segments.push(trimmed);
  }
  if (segments.length === 0) throw new HttpError(400, "query parameter is required");
  return segments;
}

function noDataError(segments: string[], index: number): Error {
  return new HttpError(404, `[content-load] no data found for "${segments.slice(0, index + 1).join(".")}"`);
}

/** Directory phase: segment → child folder, else <segment>.json file. */
async function stepIntoFs(state: ResolveState, segments: string[], index: number): Promise<void> {
  const segment = segments[index] as string;
  const childDir = join(state.dir, segment);
  if (await isDirectory(childDir)) {
    state.dir = childDir;
    return;
  }
  const jsonFile = Bun.file(join(state.dir, segment + JSON_EXT));
  if (!(await jsonFile.exists())) throw noDataError(segments, index);
  state.value = await jsonFile.json();
  state.resolvedAsValue = true;
}

/** Value phase: segment → key inside the parsed JSON. */
function stepIntoValue(state: ResolveState, segments: string[], index: number): void {
  const segment = segments[index] as string;
  if (state.value === null || typeof state.value !== "object") {
    throw new HttpError(404, `[content-load] "${segments.slice(0, index).join(".")}" has no key "${segment}"`);
  }
  const next = (state.value as JsonObject)[segment];
  if (next === undefined) throw noDataError(segments, index);
  state.value = next;
}

/**
 * Resolve a dotted path under the clone root (.migration):
 *  locales                → merged namespaces for every locale folder
 *  locales.en-US          → merged *.json of that folder
 *  locales.en-US.app      → app.json
 *  locales.en-US.app.name → key inside app.json
 */
async function resolvePath(dataPath: string): Promise<unknown> {
  const segments = splitPath(dataPath);
  const state: ResolveState = { dir: MIGRATION_DIR, value: undefined, resolvedAsValue: false };

  for (let index = 0; index < segments.length; index++) {
    if (state.resolvedAsValue) stepIntoValue(state, segments, index);
    else await stepIntoFs(state, segments, index);
  }

  if (!state.resolvedAsValue) state.value = await mergeJsonFilesInDir(state.dir);
  return state.value;
}

export async function loadContent(dataPath: string): Promise<unknown> {
  const trimmed = String(dataPath ?? "").trim();
  if (!trimmed) throw new HttpError(400, "query parameter is required");
  mlog({ phase: "begin" }, `load ${trimmed}`);
  await refresh_repo();

  const data = await resolvePath(trimmed);
  if (isEmptyData(data)) throw new HttpError(404, `[content-load] data for "${trimmed}" is empty`);
  mlog({ phase: "end" }, `load ${trimmed}`);
  return data;
}

export async function loadData(dataPath: string): Promise<ResponseType> {
  try {
    return okResponse(await loadContent(dataPath));
  } catch (err) {
    merr({ phase: "fail" }, `load ${String(dataPath ?? "")}`, err);
    return failResponse(err);
  }
}
