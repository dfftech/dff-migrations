import type { ResponseType } from "dff-util";
import { tenant_ids } from "../../db/db-connection";
import { pull_repo, reclone_repo } from "../../git/clone-repo";
import { failResponse, okResponse } from "../../http/response";
import {
  ADMIN_TRACK,
  TENANTS_TRACK,
  catalogForFolder,
  catalogForTrack,
  listExtraFolders,
  promote,
  resolveTenantFolder,
  rollback,
  type MigrationAction,
  type MigrationTrack,
} from "../../migration-runner";
import { merr, mlog } from "../../migration-runner/log";
import { session_meta } from "../../utils/app-util";

const ALL_TENANTS = "all";
const CORE_ALIAS = "core";

type ResolvedTrack = { track: MigrationTrack; tenant: string | undefined };

function resolveTenantsTrack(tenant: string | undefined): ResolvedTrack {
  const trimmed = tenant?.trim();
  if (!trimmed) {
    throw new Error(
      'tenant is required for the tenants track: pass "all" for every tenant (e.g. /migration/tenants/:version/:action/all) or a specific tenant id'
    );
  }
  const resolved = trimmed.toLowerCase() === ALL_TENANTS ? undefined : trimmed;
  return { track: TENANTS_TRACK, tenant: resolved };
}

/** /migration/{tenant}/... → that tenant's own folder pg/{tenant}, run on that tenant's DB. */
async function resolveShortcutTenant(rawTrack: string, tenant: string | undefined): Promise<ResolvedTrack> {
  const shortcut = String(rawTrack ?? "").trim();
  if (!shortcut) throw new Error("track/tenant is required");
  const explicit = tenant?.trim();
  if (explicit && explicit.toLowerCase() !== shortcut.toLowerCase()) {
    throw new Error(`conflicting tenant: path "${shortcut}" already identifies a tenant (got tenant="${tenant}")`);
  }
  const folder = await resolveTenantFolder(shortcut);
  return { track: folder, tenant: folder };
}

/**
 * `:track` path segment → track + tenant:
 *  - "core"/"admin" → admin track (core DB)
 *  - "tenants"      → tenants track; tenant required ("all" = every tenant)
 *  - anything else  → that tenant's own folder pg/{tenant}, run on that tenant's DB
 */
export async function resolveTrack(rawTrack: string, tenant: string | undefined): Promise<ResolvedTrack> {
  const normalized = String(rawTrack ?? "").trim().toLowerCase();
  if (normalized === CORE_ALIAS || normalized === ADMIN_TRACK) return { track: ADMIN_TRACK, tenant };
  if (normalized === TENANTS_TRACK) return resolveTenantsTrack(tenant);
  return resolveShortcutTenant(rawTrack, tenant);
}

async function runAction(
  action: MigrationAction,
  rawTrack: string,
  version: string,
  tenant: string | undefined
): Promise<ResponseType> {
  const ctx = { action, version, tenant, track: rawTrack };
  try {
    const resolved = await resolveTrack(rawTrack, tenant);
    ctx.tenant = resolved.tenant;
    ctx.track = resolved.track;
    mlog({ ...ctx, schema: resolved.tenant, phase: "begin" });
    await session_meta().logger.info(`Processing migration ${action}`, ctx);

    const runner = action === "promote" ? promote : rollback;
    const result = await runner(version, resolved.tenant, resolved.track);
    mlog({ ...ctx, schema: resolved.tenant, phase: "end" });

    const label = action === "promote" ? "Promote" : "Rollback";
    return okResponse({ message: `${label} completed`, ...result });
  } catch (err) {
    merr({ ...ctx, phase: "fail" }, "", err);
    return failResponse(err);
  }
}

export function runPromote(track: string, version: string, tenant?: string): Promise<ResponseType> {
  return runAction("promote", track, version, tenant);
}

export function runRollback(track: string, version: string, tenant?: string): Promise<ResponseType> {
  return runAction("rollback", track, version, tenant);
}

async function extraFolderCatalogs(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const folder of await listExtraFolders()) {
    const catalog = await catalogForFolder(folder);
    out.push({ track: folder, ...catalog });
  }
  return out;
}

/** Pulls the repo, then lists {track, versions, actions} for tenants, core and override folders. */
export async function getMigrationCatalog(): Promise<ResponseType> {
  try {
    await pull_repo();
    const tenantsCatalog = await catalogForTrack(TENANTS_TRACK);
    const coreCatalog = await catalogForTrack(ADMIN_TRACK);
    const data = [
      { track: "tenants", ...tenantsCatalog, list: [ALL_TENANTS, ...tenant_ids()] },
      { track: "core", ...coreCatalog },
      ...(await extraFolderCatalogs()),
    ];
    return okResponse(data);
  } catch (err) {
    merr({ phase: "fail" }, "catalog", err);
    return failResponse(err);
  }
}

/** Deletes the local .migration clone and clones REPO_URL fresh. */
export async function resyncMigrationRepo(): Promise<ResponseType> {
  try {
    await reclone_repo();
    return okResponse({ message: "Migration repo re-cloned" });
  } catch (err) {
    merr({ phase: "fail" }, "resync", err);
    return failResponse(err);
  }
}
