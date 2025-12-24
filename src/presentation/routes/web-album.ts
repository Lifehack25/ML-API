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

    // Check local datacenter cache first
    const cache = caches.default;
    const cacheKey = new Request(c.req.url, { method: "GET" });
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      console.log(`[Web Album] Cache HIT for lockId: ${lockId}`);
      const headers = new Headers(cachedResponse.headers);
      headers.set("X-Cache-Status", "HIT");
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers
      });
    }

    console.log(`[Web Album] Cache MISS for lockId: ${lockId}, generating HTML...`);

    // HTML generation (cache miss)
    console.log(`[Web Album] Generating HTML for lockId: ${lockId}, isOwner: ${isOwner}`);

    // Fetch album data using the ViewAlbumService
    const result = await container.services.albums.getAlbumData(lockId);

    console.log(`[Web Album] Album data fetch result: ok=${result.ok}`);

    if (!result.ok) {
      console.log(`[Web Album] Error fetching album: ${result.error.message}`);
    }

    // Track scan for visitor views (not owners, only successful data loads)
    if (!isOwner && result.ok && ctx) {
      const numericLockId = container.services.albums.decodeLockId(lockId);
      if (numericLockId) {
        // Increment scan counter asynchronously (don't block response)
        ctx.waitUntil(
          container.services.scanCounter.incrementScanAndNotify(numericLockId)
        );
      }
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
    const faviconUrl = 'https://imagedelivery.net/Fh6D8c3CvE0G8hv20vsbkw/597a1111-f618-4e91-463c-1cadc1201c00/icon';

    const metaTags = `
    <link rel="icon" href="${faviconUrl}" type="image/png">
    <link rel="apple-touch-icon" href="${faviconUrl}">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://album.memorylocks.com/?id=${lockId}">
    <meta property="og:description" content="View your Memory Locks photo album">
    ${mainImageUrl ? `<meta property="og:image" content="${mainImageUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="1200">` : ''}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${pageTitle}">
    <meta name="twitter:description" content="View your Memory Locks photo album">
    ${mainImageUrl ? `<meta name="twitter:image" content="${mainImageUrl}">` : ''}`;

    // Inject album data into the HTML (only if data was successfully fetched)
    const albumDataScript = result.ok ? `
    <script>
      window.ALBUM_DATA = ${JSON.stringify(result.data)};
      window.IS_OWNER = ${isOwner};
    </script>` : `
    <script>
      window.IS_OWNER = ${isOwner};
    </script>`;

    console.log(`[Web Album] Album data script length: ${albumDataScript.length}`);

    // Replace the default page title with dynamic title
    html = html.replace(/<title>.*?<\/title>/, `<title>${pageTitle}</title>`);

    // Insert the meta tags and scripts before the closing </head> tag (use regex to handle any whitespace)
    const beforeReplace = html.length;
    html = html.replace(/\s*<\/head>/, `${metaTags}${albumDataScript}\n  </head>`);
    const afterReplace = html.length;

    console.log(`[Web Album] HTML injection: before=${beforeReplace}, after=${afterReplace}, injected=${afterReplace > beforeReplace}`);

    // Update CSP to remove api.memorylocks.com from connect-src (no longer needed)
    html = html.replace(
      "connect-src 'self' https://api.memorylocks.com",
      "connect-src 'self'"
    );

    console.log(`[Web Album] Returning HTML response, final length: ${html.length}`);

    // Create response with cache headers
    const response = new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=604800", // 7 days - browser and CDN caching
        "X-Cache-Status": "MISS",
      },
    });

    // Store in local cache asynchronously
    if (ctx) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
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
