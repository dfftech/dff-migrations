import { t } from "elysia";

export const migrationVersionParams = t.Object({ track: t.String(), version: t.String() });
export const migrationTenantParams = t.Object({ track: t.String(), version: t.String(), tenant: t.String() });

export type MigrationVersionParams = { track: string; version: string };
export type MigrationParams = MigrationVersionParams & { tenant: string };
