import { api } from 'encore.dev/api';
import { URL } from 'node:url';
import { serveMedia } from './media-load.service';

/**
 * Streams a media file (image/video/audio) found under .migration's
 * media/assets/public roots (and their subfolders) by exact file name, e.g.:
 *   GET /media-load?media=photo-3.jpg
 *   GET /media-load?media=demo.mp4
 * Responds with the raw file bytes and a matching Content-Type, or a
 * 404 JSON error when no file with that name is found.
 */
export const Load = api.raw(
  {
    expose: true,
    method: 'GET',
    path: '/media-load',
  },
  async (req, resp) => {
    const url = new URL(req.url ?? '', 'http://internal');
    const media = url.searchParams.get('media') ?? '';
    await serveMedia(media, resp);
  }
);
