import { Hono } from 'hono';
import type { Next } from 'hono';
import type { EnvBindings } from '../../common/bindings';
import type { AppVariables } from '../../common/context';
import { getContainer } from '../http/context';
import type { ApiError } from '../http/responses';
import { injectAlbumHtml } from '../utils/html-injector';

const ALBUM_HOST = 'album.memorylocks.com';

/**
 * Web album routes for serving HTML and static assets.
 * Serves the album viewing experience at album.memorylocks.com.
 * Handles Server-Side Rendering (SSR) of album data into the index.html template.
 */
export const createWebAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Serve album HTML with server-side rendered data
  router.get('/', async (c, next: Next) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header('host');
    if (host !== ALBUM_HOST) {
      return await next();
    }

    const lockId = c.req.query('id');
    const isOwner = c.req.query('isOwner') === 'true';
    const container = getContainer(c);
    const ctx = c.get('executionCtx');

    // Validate lockId
    if (!lockId) {
      return c.json(
        { error: 'Album ID is required. Please provide ?id=YOUR_ALBUM_ID' } as ApiError,
        400
      );
    }

    // Check local datacenter cache first
    const cache = caches.default;
    const cacheKey = new Request(c.req.url, { method: 'GET' });
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      container.logger.info(`[Web Album] Cache HIT for lockId: ${lockId}`);
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-Cache-Status', 'HIT');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers,
      });
    }

    container.logger.info(`[Web Album] Cache MISS for lockId: ${lockId}, generating HTML...`);

    // HTML generation (cache miss)
    container.logger.debug(`[Web Album] Generating HTML`, { lockId, isOwner });

    // Fetch album data using the ViewAlbumService
    const result = await container.services.albums.getAlbumData(lockId);

    if (!result.ok) {
      container.logger.warn(`[Web Album] Error fetching album`, { error: result.error.message });
    }

    // Track scan for visitor views (not owners, only successful data loads)
    if (!isOwner && result.ok && ctx) {
      const numericLockId = container.services.albums.decodeLockId(lockId);
      if (numericLockId) {
        // Increment scan counter asynchronously (don't block response)
        ctx.waitUntil(container.services.scanCounter.incrementScanAndNotify(numericLockId));
      }
    }

    // Always fetch the HTML template from the assets binding (even if no data)
    const assetResponse = await c.env.ASSETS.fetch(new Request('http://assets/index.html'));

    if (!assetResponse.ok) {
      return c.json({ error: 'Failed to load album template' } as ApiError, 500);
    }

    const htmlTemplate = await assetResponse.text();

    container.logger.debug(`[Web Album] Fetched HTML template`, { length: htmlTemplate.length });

    // Inject data
    const html = injectAlbumHtml({
      html: htmlTemplate,
      lockId,
      isOwner,
      albumData: result.ok ? result.data : undefined,
    });

    container.logger.debug(`[Web Album] Generated HTML response`, { length: html.length });

    // Create response with cache headers
    const response = new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=604800', // 7 days caching
        'X-Cache-Status': 'MISS',
      },
    });

    // Store in local cache asynchronously
    if (ctx) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  });

  // Serve static assets (CSS, JS, images, audio, etc.)
  router.get('/*', async (c, next: Next) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header('host');
    if (host !== ALBUM_HOST) {
      return await next();
    }

    const url = new URL(c.req.url);
    const assetPath = url.pathname;

    // Fetch from the assets binding
    const assetResponse = await c.env.ASSETS.fetch(new Request(`http://assets${assetPath}`));

    if (!assetResponse.ok) {
      return c.notFound();
    }

    return assetResponse;
  });

  return router;
};
