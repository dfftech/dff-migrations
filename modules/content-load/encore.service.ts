import { Service } from 'encore.dev/service';
import { LoggingMiddleware } from '../../middleware/app-logging';
import { clone_repo } from '../../utils/clone-repo';

clone_repo().catch((err) => console.error(':---------Repo initialization failed---------:', err));

export default new Service('content-load', {
  middlewares: [LoggingMiddleware],
});
