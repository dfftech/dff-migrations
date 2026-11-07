import { Service } from "encore.dev/service";
import { clone_repo } from "../../utils/clone-repo";
import { LoggingMiddleware } from "../../middleware/app-logging";

clone_repo().catch((err) =>
  console.error(":---------Repo initialization failed---------:", err)
);

export default new Service("data-load", {
  middlewares: [LoggingMiddleware],
});
