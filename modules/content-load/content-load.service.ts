import type { ResponseType } from 'dff-util';
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { merr, mlog } from '../../migration-runner/log';
import { session_meta } from '../../utils/app-util';
import { MIGRATION_DIR, pull_repo } from '../../utils/clone-repo';

function fail(err: unknown, requestId: string): ResponseType {
  return {
    status: 500,
    error: { message: err instanceof Error ? err.message : String(err) },
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}

function existsAsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function existsAsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Merges every *.json file directly under "dir" into { namespace: data }.
 * If "dir" has no json files of its own but does have subdirectories
 * (e.g. .migration/locales -> en-US/, fr-FR/, ...), each subdirectory is
 * merged recursively and keyed by its folder name instead
 * (e.g. { "en-US": { app: {...}, nav: {...} }, "fr-FR": { ... } }).
 */
function mergeJsonFilesInDir(dir: string): Record<string, unknown> {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return {};
  }

  const out: Record<string, unknown> = {};
  const subDirs: string[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      subDirs.push(entry.name);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const namespace = entry.name.slice(0, -'.json'.length);
    try {
      out[namespace] = JSON.parse(readFileSync(join(dir, entry.name), 'utf8'));
    } catch (err) {
      merr({ phase: 'fail' }, 'failed to parse ' + join(dir, entry.name), err);
    }
  }

  if (Object.keys(out).length === 0 && subDirs.length > 0) {
    for (const name of subDirs) {
      const merged = mergeJsonFilesInDir(join(dir, name));
      if (Object.keys(merged).length > 0) {
        out[name] = merged;
      }
    }
  }

  return out;
}

function isEmptyData(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

/**
 * ContentLoadService: walks a dot-separated "data" path under the migration
 * clone root (.migration) and returns whatever is found at that path.
 * Each segment first tries a child directory, then a "<segment>.json"
 * file, then a key inside the JSON object resolved so far.
 *
 * Examples (repo layout: .migration/locales/{locale}/{namespace}.json):
 *  - data=locales               -> merged namespaces across every locale folder
 *  - data=locales.en-US         -> merged { app: {...}, nav: {...}, ... }
 *                                   from every *.json file in that locale folder
 *  - data=locales.en-US.app     -> parsed contents of app.json
 *  - data=locales.en-US.app.name -> further drills into the parsed JSON object
 */
export class ContentLoadService {
  /** Root directory every "data" path is resolved from (required). */
  static Db(): string {
    return MIGRATION_DIR;
  }

  private static resolvePath(dataPath: string): unknown {
    const segments = dataPath
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      throw new Error('data is required');
    }

    let dir = this.Db();
    let value: unknown;
    let resolvedAsValue = false;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (!resolvedAsValue) {
        const childDir = join(dir, segment);
        if (existsAsDir(childDir)) {
          dir = childDir;
          continue;
        }

        const jsonFile = join(dir, segment + '.json');
        if (existsAsFile(jsonFile)) {
          value = JSON.parse(readFileSync(jsonFile, 'utf8'));
          resolvedAsValue = true;
          continue;
        }

        // Segment doesn't match a subdirectory or a "<segment>.json" file
        // under the currently resolved directory: no data at this path.
        throw new Error('[content-load] no data found for "' + segments.slice(0, i + 1).join('.') + '"');
      }

      if (value === null || typeof value !== 'object') {
        throw new Error('[content-load] "' + segments.slice(0, i).join('.') + '" has no key "' + segment + '"');
      }
      value = (value as Record<string, unknown>)[segment];
      if (value === undefined) {
        throw new Error('[content-load] no data found for "' + segments.slice(0, i + 1).join('.') + '"');
      }
    }

    if (!resolvedAsValue) {
      // Reached the end of the path and it's still a directory: merge
      // every *.json namespace file found directly under it.
      value = mergeJsonFilesInDir(dir);
    }

    return value;
  }

  /** Fetch data by dotted path (required). Returns domain data, never ResponseType. */
  static async LoadService(dataPath: string): Promise<unknown> {
    const trimmed = String(dataPath ?? '').trim();
    if (!trimmed) {
      throw new Error('data query parameter is required');
    }
    mlog({ phase: 'begin' }, 'load ' + trimmed);
    await pull_repo();

    const data = this.resolvePath(trimmed);
    if (isEmptyData(data)) {
      throw new Error('[content-load] data for "' + trimmed + '" is empty');
    }
    mlog({ phase: 'end' }, 'load ' + trimmed);
    return data;
  }
}

export async function loadData(dataPath: string): Promise<ResponseType> {
  const { request_id } = session_meta();
  try {
    const data = await ContentLoadService.LoadService(dataPath);
    return {
      status: 200,
      data,
      meta: { requestId: request_id, timestamp: new Date().toISOString() },
    };
  } catch (err) {
    merr({ phase: 'fail' }, 'load ' + String(dataPath ?? ''), err);
    return fail(err, request_id);
  }
}
