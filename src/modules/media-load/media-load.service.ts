import { basename, join } from "node:path";
import { MIGRATION_DIR, refresh_repo } from "../../git/clone-repo";
import { HttpError, errorMessage, errorStatus, failResponse, sendResponse } from "../../http/response";
import { emitAppLog } from "../../logging/kafka-logger";
import { isDirectory } from "../../utils/fs-util";

/** Folders (directly under .migration) searched, in order. */
const MEDIA_FOLDERS = ["media", "assets", "public"];
const CACHE_CONTROL = "public, max-age=3600";
const ALL_FILES = new Bun.Glob("**/*");

async function mediaRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const folder of MEDIA_FOLDERS) {
    const root = join(MIGRATION_DIR, folder);
    if (await isDirectory(root)) roots.push(root);
  }
  return roots;
}

function assertPlainName(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new HttpError(400, "query parameter is required");
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new HttpError(400, "media must be a plain file name, not a path");
  }
  return trimmed;
}

/** Exact basename match in root (top level first, then every sub-folder via Bun.Glob). */
async function findInRoot(root: string, name: string): Promise<string | undefined> {
  const direct = join(root, name);
  if (await Bun.file(direct).exists()) return direct;

  const scanOptions = { cwd: root, onlyFiles: true, dot: true };
  for await (const relative of ALL_FILES.scan(scanOptions)) {
    if (basename(relative) === name) return join(root, relative);
  }
  return undefined;
}

export async function findMediaFile(name: string): Promise<string> {
  const fileName = assertPlainName(name);
  await refresh_repo();
  for (const root of await mediaRoots()) {
    const found = await findInRoot(root, fileName);
    if (found) return found;
  }
  throw new HttpError(404, `[media-load] no media file named "${fileName}" found`);
}

/** Stream the file (Bun.file → zero-copy response body) with its MIME type. */
export async function serveMedia(name: string): Promise<Response> {
  try {
    const path = await findMediaFile(name);
    const file = Bun.file(path);
    const headers = {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Length": String(file.size),
      "Cache-Control": CACHE_CONTROL,
    };
    emitAppLog("info", `media-load served ${name}`, { path });
    const init = { status: 200, headers };
    return new Response(file, init);
  } catch (err) {
    emitAppLog("error", `media-load failed ${String(name ?? "")}`, { error: errorMessage(err) });
    return sendResponse(failResponse(err, errorStatus(err, 404)));
  }
}
