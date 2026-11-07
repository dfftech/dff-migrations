import { createReadStream, readdirSync, statSync, type Dirent } from 'node:fs';
import { extname, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { MIGRATION_DIR, pull_repo } from '../../utils/clone-repo';
import { emitAppLog } from '../../middleware/kafka-logger';

/** Folders (directly under .migration) searched, in order, for a media file. */
const MEDIA_FOLDERS = ['media', 'assets', 'public'];

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function contentTypeFor(fileName: string): string {
  return CONTENT_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function existsAsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively searches dir (and every subfolder) for a file with an exact basename match. */
function findFileByName(dir: string, name: string): string | undefined {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) {
      return join(dir, entry.name);
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileByName(join(dir, entry.name), name);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * MediaLoadService: looks up a media file by its exact basename
 * (e.g. "photo-3.jpg") across every known media root (media, assets,
 * public — whichever exist directly under the migration clone) and all
 * of their subfolders (e.g. .migration/media/abcd/photo-3.jpg).
 */
export class MediaLoadService {
  /** Root directory every media root is resolved from (required). */
  static Db(): string {
    return MIGRATION_DIR;
  }

  /** Known top-level media root folders that actually exist on disk. */
  static MediaRoots(): string[] {
    const root = this.Db();
    return MEDIA_FOLDERS.map((folder) => join(root, folder)).filter(existsAsDir);
  }

  /** Finds the absolute path for a media file by basename (required). */
  static async FindService(name: string): Promise<string> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) {
      throw new Error('media query parameter is required');
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
      throw new Error('media must be a plain file name, not a path');
    }

    await pull_repo();

    for (const root of this.MediaRoots()) {
      const found = findFileByName(root, trimmed);
      if (found) return found;
    }

    throw new Error('[media-load] no media file named "' + trimmed + '" found');
  }
}

/** Streams the resolved media file as the raw HTTP response body. */
export async function serveMedia(name: string, resp: ServerResponse): Promise<void> {
  try {
    const path = await MediaLoadService.FindService(name);
    const size = statSync(path).size;
    resp.writeHead(200, {
      'Content-Type': contentTypeFor(path),
      'Content-Length': size,
      'Cache-Control': 'public, max-age=3600',
    });
    createReadStream(path).pipe(resp);
    emitAppLog('info', 'media-load served ' + name, { path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitAppLog('error', 'media-load failed ' + String(name ?? ''), { error: message });
    resp.writeHead(404, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify({ status: 404, error: { message } }));
  }
}
