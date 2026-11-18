import { Elysia, t } from "elysia";
import { sendResponse } from "../../http/response";
import { loadData } from "./content-load.service";

type ContentLoadContext = { query: { query?: string } };

const contentLoadSchema = { query: t.Object({ query: t.Optional(t.String()) }) };

/** GET /content-load?query=locales.en-US.app */
async function getContent({ query }: ContentLoadContext): Promise<Response> {
  return sendResponse(await loadData(query.query ?? ""));
}

export const contentLoadRoutes = new Elysia({ name: "content-load" }).get("/content-load", contentLoadSchema, getContent);
