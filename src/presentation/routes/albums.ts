import { Hono } from "hono";
import { jwt } from "hono/jwt";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import { respondFromService } from "../http/responses";
import { setUserContext } from "../http/middleware";
import type { AppConfig } from "../../config/env";
import {
  cacheGet,
  cachePut,
  addCacheHeader,
  getCacheKeyAlbum,
} from "../../infrastructure/cache";

export const createAlbumRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Album fetch endpoint for MAUI app (requires JWT authentication)
  // This endpoint does NOT increment scan counts (only for app usage)
  router.get(
    "/:hashedId",
    jwt({ secret: config.jwt.secret, alg: "HS256" }),
    setUserContext(),
    async (c) => {
      const hashedId = c.req.param("hashedId");
      const container = getContainer(c);

      // Single cache key for all viewers
      const cacheKey = getCacheKeyAlbum(hashedId);

      // Try to get from cache first
      const cached = await cacheGet(cacheKey);

      if (cached) {
        // Cache hit!
        return addCacheHeader(cached, true);
      }

      // Cache miss - fetch from database
      const result = await container.services.albums.getAlbumData(hashedId);

      // Handle errors (don't cache error responses)
      if (!result.ok) {
        return respondFromService(c, result);
      }

      // Success - cache for 12 hours
      const ttlSeconds = 43200;
      await cachePut(cacheKey, result.data, { ttlSeconds });

      // Return response with cache miss header
      const response = new Response(JSON.stringify(result.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Cache": "MISS",
        },
      });

      return response;
    }
  );

  return router;
};
