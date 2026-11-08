import type { ResponseType } from 'dff-util';
import { api } from 'encore.dev/api';
import { loadData } from './content-load.service';
import type { RequestByQuery } from './content-load.types';

/**
 * Loads migration content (currently .migration/locales/...) by a dotted
 * "query" query param, e.g.:
 *   GET /content-load?query=locales
 *   GET /content-load?query=locales.en-US
 *   GET /content-load?query=locales.en-US.app
 * Returns an error response if the resolved data is empty.
 */
export const Load = api<RequestByQuery, ResponseType>(
  {
    expose: true,
    method: 'GET',
    path: '/content-load',
  },
  async ({ query }) => loadData(query)
);
