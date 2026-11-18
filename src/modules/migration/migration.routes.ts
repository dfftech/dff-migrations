import { Elysia } from "elysia";
import { sendResponse } from "../../http/response";
import { getMigrationCatalog, resyncMigrationRepo, runPromote, runRollback } from "./migration.service";
import {
  migrationTenantParams,
  migrationVersionParams,
  type MigrationParams,
  type MigrationVersionParams,
} from "./migration.types";

type VersionContext = { params: MigrationVersionParams };
type TenantContext = { params: MigrationParams };

const versionSchema = { params: migrationVersionParams };
const tenantSchema = { params: migrationTenantParams };

async function promoteAll({ params }: VersionContext): Promise<Response> {
  return sendResponse(await runPromote(params.track, params.version));
}

async function promoteTenant({ params }: TenantContext): Promise<Response> {
  return sendResponse(await runPromote(params.track, params.version, params.tenant));
}

async function rollbackAll({ params }: VersionContext): Promise<Response> {
  return sendResponse(await runRollback(params.track, params.version));
}

async function rollbackTenant({ params }: TenantContext): Promise<Response> {
  return sendResponse(await runRollback(params.track, params.version, params.tenant));
}

async function catalog(): Promise<Response> {
  return sendResponse(await getMigrationCatalog());
}

async function resync(): Promise<Response> {
  return sendResponse(await resyncMigrationRepo());
}

export const migrationRoutes = new Elysia({ name: "migration" })
  .get("/migration/catalog", catalog)
  .get("/migration/resync", resync)
  .get("/migration/:track/:version/promote", versionSchema, promoteAll)
  .get("/migration/:track/:version/promote/:tenant", tenantSchema, promoteTenant)
  .get("/migration/:track/:version/rollback", versionSchema, rollbackAll)
  .get("/migration/:track/:version/rollback/:tenant", tenantSchema, rollbackTenant);
