import { Hono } from "hono";
import type { Next } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import type { ApiError } from "../http/responses";

const ALBUM_HOST = "album.memorylocks.com";

/**
 * Web album routes for serving HTML and static assets
 * Serves the album viewing experience at album.memorylocks.com
 */
export const createWebAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Lightweight beacon endpoint for tracking scans (bypasses cache)
  router.post("/scan-beacon", async (c) => {
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
  router.get("/", async (c, next: Next) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header("host");
    if (host !== ALBUM_HOST) {
      return await next();
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
    }

    // Always fetch the HTML template from the assets binding (even if no data)
    const assetResponse = await c.env.ASSETS.fetch(
      new Request("http://assets/index.html")
    );

    if (!assetResponse.ok) {
      return c.json({ error: "Failed to load album template" } as ApiError, 500);
    }

    let html = await assetResponse.text();

    console.log(`[Web Album] Fetched HTML template, length: ${html.length}`);

    // Extract main image URL for Open Graph tags (if data loaded successfully)
    const mainImage = result.ok ? result.data.Media.find(m => m.IsMainImage) : null;
    const mainImageUrl = mainImage?.Url || null;

    // Generate dynamic page title
    const pageTitle = result.ok ? result.data.AlbumTitle : 'Memory Locks Album';

    // Generate Open Graph and Twitter Card meta tags
    const faviconUrl = 'https://album.memorylocks.com/Resources/favicon.webp?v=2';

    const metaTags = `
    <link rel="icon" href="${faviconUrl}" type="image/webp">
    <link rel="apple-touch-icon" href="${faviconUrl}">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://album.memorylocks.com/?id=${lockId}">
    <meta property="og:description" content="View your Memory Locks photo album">
    ${mainImageUrl ? `<meta property="og:image" content="${mainImageUrl}">` : `<meta property="og:image" content="${faviconUrl}">`}
    ${mainImageUrl ? `<meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="1200">` : `<meta property="og:image:width" content="512">\n    <meta property="og:image:height" content="512">`}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageTitle}">
    <meta name="twitter:description" content="View your Memory Locks photo album">
    ${mainImageUrl ? `<meta name="twitter:image" content="${mainImageUrl}">` : `<meta name="twitter:image" content="${faviconUrl}">`}`;

    // Inject album data into the HTML (only if data was successfully fetched)
    const albumDataScript = result.ok ? `
    <script>
      window.ALBUM_DATA = ${JSON.stringify(result.data)};
      window.IS_OWNER = ${isOwner};
    </script>` : `
    <script>
      window.IS_OWNER = ${isOwner};
    </script>`;

    // Inject scan beacon for visitor views only (not for owners)
    // Only fires if ALBUM_DATA exists (prevents beacon on failed data loads)
    const beaconScript = !isOwner ? `
    <script>
      // Fire scan beacon on page load (only for visitors with valid data)
      if (!window.IS_OWNER && window.ALBUM_DATA) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            navigator.sendBeacon('/scan-beacon?id=${lockId}');
          });
        } else {
          // Page already loaded, fire immediately
          navigator.sendBeacon('/scan-beacon?id=${lockId}');
        }
      }
    </script>` : '';

    console.log(`[Web Album] Album data script length: ${albumDataScript.length}, beacon: ${beaconScript.length}`);

    // Replace the default page title with dynamic title
    html = html.replace(/<title>.*?<\/title>/, `<title>${pageTitle}</title>`);

    // Insert the meta tags and scripts before the closing </head> tag (use regex to handle any whitespace)
    const beforeReplace = html.length;
    html = html.replace(/\s*<\/head>/, `${metaTags}${albumDataScript}${beaconScript}\n  </head>`);
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
  router.get("/*", async (c, next: Next) => {
    // Only handle requests for album.memorylocks.com
    const host = c.req.header("host");
    if (host !== ALBUM_HOST) {
      return await next();
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
