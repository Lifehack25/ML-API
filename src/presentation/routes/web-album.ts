import { Hono } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import type { ApiError } from "../http/responses";

/**
 * Web album routes for serving HTML and static assets
 * Serves the album viewing experience at album.memorylocks.com
 */
export const createWebAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Lightweight beacon endpoint for tracking scans (bypasses cache)
  router.get("/scan-beacon", async (c) => {
    const host = c.req.header("host");
    if (host !== "album.memorylocks.com") {
      return c.json({ error: "Invalid host" }, 400);
    }

    const lockId = c.req.query("id");
    if (!lockId) {
      return c.json({ error: "Missing id" }, 400);
    }

    const container = getContainer(c);
    const ctx = c.get("executionCtx");
    const numericLockId = container.services.albums.decodeLockId(lockId);

    if (numericLockId && ctx) {
      // Increment scan counter asynchronously (don't block response)
      ctx.waitUntil(
        container.services.scanCounter.incrementScanAndNotify(numericLockId)
      );
    }

    // Return minimal response with no-cache headers
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "Access-Control-Allow-Origin": "https://album.memorylocks.com",
      },
    });
  });

  // Serve album HTML with server-side rendered data
  router.get("/", async (c) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header("host");
    if (host !== "album.memorylocks.com") {
      return; // Let other routes handle it
    }

    const lockId = c.req.query("id");
    const isOwner = c.req.query("isOwner") === "true";
    const container = getContainer(c);
    const ctx = c.get("executionCtx");

    // Validate lockId
    if (!lockId) {
      return c.json({ error: "Album ID is required. Please provide ?id=YOUR_ALBUM_ID" } as ApiError, 400);
    }

    console.log(`[Web Album] Request for lockId: ${lockId}, isOwner: ${isOwner}, host: ${host}`);

    // Fetch album data using the ViewAlbumService
    const result = await container.services.albums.getAlbumData(lockId);

    console.log(`[Web Album] Album data fetch result: ok=${result.ok}`);

    if (!result.ok) {
      console.log(`[Web Album] Error fetching album: ${result.error.message}`);
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
        result.status as 404 | 500
      );
    }

    // Fetch the HTML template from the assets binding
    const assetResponse = await c.env.ASSETS.fetch(
      new Request("http://assets/index.html")
    );

    if (!assetResponse.ok) {
      return c.json({ error: "Failed to load album template" } as ApiError, 500);
    }

    let html = await assetResponse.text();

    console.log(`[Web Album] Fetched HTML template, length: ${html.length}`);

    // Inject album data into the HTML
    const albumDataScript = `
    <script>
      window.ALBUM_DATA = ${JSON.stringify(result.data)};
      window.IS_OWNER = ${isOwner};
    </script>`;

    // Inject scan beacon for visitor views only (not for owners)
    const beaconScript = !isOwner ? `
    <script>
      // Fire scan beacon on page load (only for visitors)
      if (!window.IS_OWNER && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          navigator.sendBeacon('/scan-beacon?id=${lockId}');
        });
      } else if (!window.IS_OWNER) {
        // Page already loaded, fire immediately
        navigator.sendBeacon('/scan-beacon?id=${lockId}');
      }
    </script>` : '';

    console.log(`[Web Album] Album data script length: ${albumDataScript.length}, beacon: ${beaconScript.length}`);

    // Insert the scripts before the closing </head> tag (use regex to handle any whitespace)
    const beforeReplace = html.length;
    html = html.replace(/\s*<\/head>/, `${albumDataScript}${beaconScript}\n  </head>`);
    const afterReplace = html.length;

    console.log(`[Web Album] HTML injection: before=${beforeReplace}, after=${afterReplace}, injected=${afterReplace > beforeReplace}`);

    // Update CSP to remove api.memorylocks.com from connect-src (no longer needed)
    html = html.replace(
      "connect-src 'self' https://api.memorylocks.com",
      "connect-src 'self'"
    );

    console.log(`[Web Album] Returning HTML response, final length: ${html.length}`);

    // Note: Scan counting is handled by client-side beacon (/scan-beacon)
    // This allows edge caching while still tracking all visitor views

    // Enable Cloudflare edge caching - cached responses will bypass the worker
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=604800, s-maxage=604800", // 7 days
        "X-Cache-Status": "MISS", // Will be HIT on subsequent requests from edge
      },
    });
  });

  // Serve static assets (CSS, JS, images, audio, etc.)
  router.get("/*", async (c) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header("host");
    if (host !== "album.memorylocks.com") {
      return; // Let other routes handle it
    }

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
