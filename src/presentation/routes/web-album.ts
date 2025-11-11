import { Hono } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import { fail } from "../http/responses";
import {
  getCacheKeyAlbum,
  addCacheHeader,
} from "../../infrastructure/cache";

/**
 * Web album routes for serving HTML and static assets
 * Serves the album viewing experience at album.memorylocks.com
 */
export const createWebAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Serve album HTML with server-side rendered data
  router.get("/", async (c) => {
    const lockId = c.req.query("id");
    const isOwner = c.req.query("isOwner") === "true";
    const container = getContainer(c);
    const ctx = c.get("executionCtx");

    // Validate lockId
    if (!lockId) {
      return fail(c, "Album ID is required. Please provide ?id=YOUR_ALBUM_ID", 400);
    }

    // Try to get cached HTML first (cache key based on lockId)
    const cacheKey = getCacheKeyAlbum(lockId);
    const cacheRequest = new Request(`https://cache.memorylocks.internal/${cacheKey}-html`, {
      method: 'GET'
    });

    const cache = (caches as any).default as Cache;
    const cachedHtml = await cache.match(cacheRequest);

    if (cachedHtml) {
      // Cache hit! Increment scan counter if needed (deferred)
      if (!isOwner) {
        const numericLockId = container.services.albums.decodeLockId(lockId);
        if (numericLockId && ctx) {
          ctx.waitUntil(
            container.services.scanCounter.incrementScanAndNotify(numericLockId)
          );
        }
      }

      return addCacheHeader(cachedHtml, true);
    }

    // Cache miss - fetch album data using the ViewAlbumService
    const result = await container.services.albums.getAlbumData(lockId);

    if (!result.ok) {
      return c.html(
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Album Not Found</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .error-container {
      text-align: center;
      padding: 2rem;
    }
    h1 { font-size: 3rem; margin: 0; }
    p { font-size: 1.2rem; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>Album Not Found</h1>
    <p>${result.error.message}</p>
  </div>
</body>
</html>`,
        result.status
      );
    }

    // Fetch the HTML template from the assets binding
    const assetResponse = await c.env.ASSETS.fetch(
      new Request("http://assets/index.html")
    );

    if (!assetResponse.ok) {
      return fail(c, "Failed to load album template", 500);
    }

    let html = await assetResponse.text();

    // Inject album data into the HTML
    const albumDataScript = `
    <script>
      window.ALBUM_DATA = ${JSON.stringify(result.data)};
      window.IS_OWNER = ${isOwner};
    </script>`;

    // Insert the script before the closing </head> tag (use regex to handle any whitespace)
    html = html.replace(/\s*<\/head>/, `${albumDataScript}\n  </head>`);

    // Update CSP to remove api.memorylocks.com from connect-src (no longer needed)
    html = html.replace(
      "connect-src 'self' https://api.memorylocks.com",
      "connect-src 'self'"
    );

    // Cache the HTML response for 10 minutes
    const ttlSeconds = 600;
    const htmlResponse = new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": `public, max-age=${ttlSeconds}`,
        "X-Cache": "MISS",
      },
    });

    // Store in cache (async, don't await)
    ctx?.waitUntil(cache.put(cacheRequest, htmlResponse.clone()));

    // Increment scan counter for non-owner views (deferred)
    if (!isOwner) {
      const numericLockId = container.services.albums.decodeLockId(lockId);
      if (numericLockId && ctx) {
        ctx.waitUntil(
          container.services.scanCounter.incrementScanAndNotify(numericLockId)
        );
      }
    }

    return htmlResponse;
  });

  // Serve static assets (CSS, JS, images, audio, etc.)
  router.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const assetPath = url.pathname;

    // Fetch from the assets binding
    const assetResponse = await c.env.ASSETS.fetch(
      new Request(`http://assets${assetPath}`)
    );

    if (!assetResponse.ok) {
      return c.notFound();
    }

    return assetResponse;
  });

  return router;
};
