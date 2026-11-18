import { Elysia, t } from "elysia";
import { sendResponse } from "../../http/response";
import { healthCheck } from "./health.service";

type HealthContext = { params: { id: string } };

const healthSchema = { params: t.Object({ id: t.String() }) };

async function getHealth({ params }: HealthContext): Promise<Response> {
  return sendResponse(await healthCheck(params.id));
}

export const healthRoutes = new Elysia({ name: "health" }).get("/health/:id", healthSchema, getHealth);
