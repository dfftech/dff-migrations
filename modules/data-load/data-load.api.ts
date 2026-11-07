import type { ResponseType } from 'dff-util';
import { api } from 'encore.dev/api';
import { loadData } from './data-load.service';
import type { DataLoadParams } from './data-load.types';

/**
 * Loads migration content (currently .migration/locales/...) by a dotted
 * "data" query param, e.g.:
 *   GET /data-load?data=locales
 *   GET /data-load?data=locales.en-US
 *   GET /data-load?data=locales.en-US.app
 * Returns an error response if the resolved data is empty.
 */
export const Load = api<DataLoadParams, ResponseType>(
  {
    expose: true,
    method: 'GET',
    path: '/data-load',
  },
  async ({ data }) => loadData(data)
);
