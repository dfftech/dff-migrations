import { api } from 'encore.dev/api';
import { URL } from 'node:url';
import type { RequestByQuery } from '../../utils/app-types';
import { serveMedia } from './media-load.service';

/**
 * Streams a media file (image/video/audio) found under .migration's
 * media/assets/public roots (and their subfolders) by exact file name, e.g.:
 *   GET /media-load?query=photo-3.jpg
 *   GET /media-load?query=demo.mp4
 * Responds with the raw file bytes and a matching Content-Type, or a
 * 404 JSON error when no file with that name is found.
 *
 * Uses api.raw (rather than a typed api handler) because serveMedia streams
 * raw bytes and custom headers directly onto the ServerResponse. The "query"
 * param is still read using the same RequestByQuery shape used by content-load.
 */
export const Load = api.raw(
  {
    expose: true,
    method: 'GET',
    path: '/media-load',
  },
  async (req, resp) => {
    const url = new URL(req.url ?? '', 'http://internal');
    const { query }: RequestByQuery = { query: url.searchParams.get('query') ?? '' };
    await serveMedia(query, resp);
  }
);
