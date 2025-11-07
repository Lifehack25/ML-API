import { Hono } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import { respondFromService } from "../http/responses";
import { rateLimiters } from "../http/rateLimit";
import {
  cacheGet,
  cachePut,
  addCacheHeader,
  getCacheKeyAlbum,
} from "../../infrastructure/cache";

export const createAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Album fetch endpoint with edge caching (both owner and public)
  router.get("/:hashedId", rateLimiters.albumRead, async (c) => {
    const hashedId = c.req.param("hashedId");
    const isOwner = c.req.query("isOwner") === "true";
    const ctx = c.get("executionCtx");
    const container = getContainer(c);

    // Single cache key for all viewers (owner and public share same cache)
    const cacheKey = getCacheKeyAlbum(hashedId);

    // Try to get from cache first
    const cached = await cacheGet(cacheKey);

    if (cached) {
      // Cache hit!
      const cachedResponse = addCacheHeader(cached, true);

      // For public views, increment scan counter asynchronously (deferred)
      if (!isOwner) {
        const lockId = container.services.albums.decodeLockId(hashedId);
        if (lockId && ctx) {
          ctx.waitUntil(
            container.services.scanCounter.incrementScanAndNotify(lockId)
          );
        }
      }

      return cachedResponse;
    }

    // Cache miss - fetch from database
    const result = await container.services.albums.getAlbumData(hashedId);

    // Handle errors (don't cache error responses)
    if (!result.ok) {
      return respondFromService(c, result);
    }

    // Success - cache for 10 minutes
    const ttlSeconds = 600; // 10 minutes for all views
    await cachePut(cacheKey, result.data, { ttlSeconds });

    // For public views, increment scan counter asynchronously (deferred)
    if (!isOwner) {
      const lockId = container.services.albums.decodeLockId(hashedId);
      if (lockId && ctx) {
        ctx.waitUntil(
          container.services.scanCounter.incrementScanAndNotify(lockId)
        );
      }
    }

    // Return response with cache miss header
    const response = new Response(JSON.stringify(result.data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
      },
    });

    return response;
  });

  return router;
};

