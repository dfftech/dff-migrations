import git, { type AuthCallback, type GitAuth, type GitProgressEvent, type HttpClient } from "isomorphic-git";
import gitHttp from "isomorphic-git/http/node";
import fs from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { env, env_base_name } from "../config/env";
import { writeLog } from "../logging/logger";
import { fileExists, isDirectory } from "../utils/fs-util";

const BRANCH = "main";
const HTTP_TIMEOUT_MS = 100 * 60 * 1000;

/** Git clone root (.git lives here). */
export const MIGRATION_DIR = join(process.cwd(), ".migration");
const LEGACY_MIGRATION_DIR = join(process.cwd(), "migration");

/** Migration SQL lives under the "pg" subfolder of the clone. */
export const MIGRATION_CONTENT_DIR = join(MIGRATION_DIR, "pg");
const SESSION_STAMP = join(MIGRATION_DIR, ".server-session");

type RepoAuth = { repoUrl: string; token: string };
type GitRequest = Parameters<HttpClient["request"]>[0];

type GlobalWithSession = typeof globalThis & { __DFF_SERVER_SESSION__?: string };

let clonePromise: Promise<void> | null = null;
let pullPromise: Promise<void> | null = null;
let lastClonePhase = "";

function gitRequestWithTimeout(request: GitRequest) {
  const timedRequest = { ...request, timeout: HTTP_TIMEOUT_MS } as GitRequest;
  return gitHttp.request(timedRequest);
}

const http: HttpClient = { request: gitRequestWithTimeout };

/**
 * Stable for one process (kept across `bun --hot` reloads via globalThis),
 * new on every real server start.
 */
function serverSessionId(): string {
  const scope = globalThis as GlobalWithSession;
  if (!scope.__DFF_SERVER_SESSION__) scope.__DFF_SERVER_SESSION__ = Bun.randomUUIDv7();
  return scope.__DFF_SERVER_SESSION__;
}

function publicRepoUrl(repoUrl: string): string {
  try {
    const parsed = new URL(repoUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return repoUrl;
  }
}

function authFor(auth: RepoAuth): GitAuth {
  const host = new URL(auth.repoUrl).hostname;
  if (host.includes("gitlab")) return { username: "oauth2", password: auth.token };
  if (host.includes("bitbucket")) return { username: "x-token-auth", password: auth.token };
  return { username: "x-access-token", password: auth.token };
}

function authCallback(auth: RepoAuth): AuthCallback {
  return authFor.bind(null, auth);
}

function logClonePhase(event: GitProgressEvent): void {
  if (event.phase === lastClonePhase) return;
  lastClonePhase = event.phase;
  writeLog("info", `[migration] ${event.phase}`);
}

function repoAuth(): RepoAuth | null {
  const repoUrl = env("REPO_URL")?.trim();
  const token = env("REPO_TOKEN")?.trim();
  if (!repoUrl) return null;
  if (!token) throw new Error(`${env_base_name()}_REPO_TOKEN is not set`);
  return { repoUrl, token };
}

async function overwriteFromRemote(auth: RepoAuth): Promise<void> {
  writeLog("info", `[migration] fetch --force ${publicRepoUrl(auth.repoUrl)} branch=${BRANCH}`);
  const fetchOptions = {
    fs,
    http,
    dir: MIGRATION_DIR,
    url: auth.repoUrl,
    remote: "origin",
    ref: BRANCH,
    singleBranch: true,
    depth: 1,
    onAuth: authCallback(auth),
  };
  await git.fetch(fetchOptions);

  const remoteRef = { fs, dir: MIGRATION_DIR, ref: `refs/remotes/origin/${BRANCH}` };
  const oid = await git.resolveRef(remoteRef);
  const localRef = { fs, dir: MIGRATION_DIR, ref: `refs/heads/${BRANCH}`, value: oid, force: true };
  await git.writeRef(localRef);
  const checkoutOptions = { fs, dir: MIGRATION_DIR, ref: BRANCH, force: true };
  await git.checkout(checkoutOptions);
  writeLog("info", `[migration] reset --hard origin/${BRANCH} ${oid.slice(0, 8)}`);
}

async function runPull(): Promise<void> {
  await clone_repo();
  const auth = repoAuth();
  if (!auth) {
    writeLog("warn", `[migration] skip pull: ${env_base_name()}_REPO_URL is not set`);
    return;
  }
  if (!(await isDirectory(join(MIGRATION_DIR, ".git")))) {
    writeLog("warn", "[migration] skip pull: clone missing");
    return;
  }
  await overwriteFromRemote(auth);
}

function clearPull(): void {
  pullPromise = null;
}

/** Fetch origin and overwrite local .migration with remote HEAD (deduped). */
export function pull_repo(): Promise<void> {
  if (!pullPromise) pullPromise = runPull().finally(clearPull);
  return pullPromise;
}

function ignoreError(): void {}

async function hasLocalClone(): Promise<boolean> {
  return fileExists(join(MIGRATION_DIR, ".git", "HEAD"));
}

/**
 * Pull, but keep serving the local clone when the remote is unreachable
 * (content/media reads must not fail because GitLab/GitHub is slow or down).
 */
export async function refresh_repo(): Promise<void> {
  try {
    await pull_repo();
  } catch (err) {
    if (!(await hasLocalClone())) throw err;
    const fields = { error: err instanceof Error ? err.message : String(err) };
    writeLog("warn", "[migration] pull failed, serving existing local clone", fields);
  }
}

/** Delete the local clone entirely and clone REPO_URL fresh. */
export async function reclone_repo(): Promise<void> {
  if (clonePromise) await clonePromise.catch(ignoreError);
  if (pullPromise) await pullPromise.catch(ignoreError);

  writeLog("info", `[migration] reclone: deleting existing clone ${MIGRATION_DIR}`);
  await rm(MIGRATION_DIR, { recursive: true, force: true });

  clonePromise = null;
  await clone_repo();
  writeLog("info", "[migration] reclone completed");
}

async function isSameServerSession(): Promise<boolean> {
  const stamp = Bun.file(SESSION_STAMP);
  if (!(await stamp.exists())) return false;
  const previous = (await stamp.text()).trim();
  return previous === serverSessionId();
}

async function runClone(): Promise<void> {
  const auth = repoAuth();
  if (!auth) {
    writeLog("warn", `[migration] skip clone: ${env_base_name()}_REPO_URL is not set`);
    return;
  }

  await rm(LEGACY_MIGRATION_DIR, { recursive: true, force: true });

  const cloned = await fileExists(join(MIGRATION_DIR, ".git", "HEAD"));
  if (cloned && (await isSameServerSession())) {
    writeLog("info", "[migration] hot reload, keep existing clone");
    return;
  }

  writeLog("info", "[migration] server start, resetting clone dir");
  await rm(MIGRATION_DIR, { recursive: true, force: true });
  await mkdir(MIGRATION_DIR, { recursive: true });

  writeLog("info", `[migration] cloning ${publicRepoUrl(auth.repoUrl)} branch=${BRANCH} into ${MIGRATION_DIR}`);
  lastClonePhase = "";
  const cloneOptions = {
    fs,
    http,
    dir: MIGRATION_DIR,
    url: auth.repoUrl,
    ref: BRANCH,
    singleBranch: true,
    depth: 1,
    onAuth: authCallback(auth),
    onProgress: logClonePhase,
  };
  await git.clone(cloneOptions);

  await Bun.write(SESSION_STAMP, serverSessionId());
  writeLog("info", "[migration] clone completed");
}

function resetClone(err: unknown): never {
  clonePromise = null;
  throw err;
}

/** Clone REPO_URL (main) into ./.migration using REPO_TOKEN (memoized per process). */
export function clone_repo(): Promise<void> {
  if (!clonePromise) clonePromise = runClone().catch(resetClone);
  return clonePromise;
}
