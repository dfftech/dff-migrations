import { Service } from "encore.dev/service";
import { clone_repo } from "../../utils/clone-repo";

// api.raw handlers write directly to the Node ServerResponse and bypass
// Encore's typed response pipeline, so the shared LoggingMiddleware (which
// expects a structured response with .header) is not attached here.
clone_repo().catch((err) =>
  console.error(":---------Repo initialization failed---------:", err)
);

export default new Service("media-load", {});
