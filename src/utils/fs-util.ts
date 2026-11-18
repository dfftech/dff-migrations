import { readdir, stat } from "node:fs/promises";

/** True when path is an existing regular file (Bun.file check). */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

/** True when path is an existing directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Child directory names (hidden ones skipped), sorted. Missing dir → []. */
export async function listChildDirs(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) names.push(entry.name);
    }
  } catch {
    return [];
  }
  return names.sort();
}

/** Child names of any kind. Missing dir → []. */
export async function listChildNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Read a text file with Bun.file; throws a clear error when missing. */
export async function readTextFile(path: string, label = "file"): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing ${label}: ${path}`);
  return file.text();
}
