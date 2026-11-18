import { Elysia, t } from "elysia";
import { serveMedia } from "./media-load.service";

type MediaLoadContext = { query: { query?: string } };

const mediaLoadSchema = { query: t.Object({ query: t.Optional(t.String()) }) };

/** GET /media-load?query=photo-3.jpg — streams the raw file. */
function getMedia({ query }: MediaLoadContext): Promise<Response> {
  return serveMedia(query.query ?? "");
}

export const mediaLoadRoutes = new Elysia({ name: "media-load" }).get("/media-load", mediaLoadSchema, getMedia);
