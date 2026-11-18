import { Elysia } from "elysia";
import { errorMessage, errorStatus, failResponse, sendResponse } from "./http/response";
import { currentAppLogger } from "./logging/kafka-logger";
import { contentLoadRoutes } from "./modules/content-load/content-load.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { mediaLoadRoutes } from "./modules/media-load/media-load.routes";
import { migrationRoutes } from "./modules/migration/migration.routes";

type AppErrorContext = { error: unknown };

/** Global error handler: log once, answer with the ResponseType error shape. */
async function handleAppError({ error }: AppErrorContext): Promise<Response> {
  const status = errorStatus(error);
  const errorFields = {
    status,
    error_message: errorMessage(error),
    error_stack: error instanceof Error ? error.stack : undefined,
  };
  await currentAppLogger().error("Request failed", errorFields);
  return sendResponse(failResponse(error, status));
}

export const app = new Elysia()
  .onError(handleAppError)
  .use(healthRoutes)
  .use(migrationRoutes)
  .use(contentLoadRoutes)
  .use(mediaLoadRoutes);

export type App = typeof app;
