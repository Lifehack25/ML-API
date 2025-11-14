import { Hono } from "hono";
import { jwt } from "hono/jwt";
import type { StatusCode } from "hono/utils/http-status";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import type { ApiError } from "../http/responses";
import { setUserContext } from "../http/middleware";
import type { AppConfig } from "../../config/env";

export const createAlbumRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Album fetch endpoint for MAUI app (requires JWT authentication)
  // This endpoint does NOT increment scan counts (only for app usage)
  // No edge caching - MAUI app caches responses client-side
  router.get(
    "/:hashedId",
    jwt({ secret: config.jwt.secret, alg: "HS256" }),
    setUserContext(),
    async (c) => {
      const hashedId = c.req.param("hashedId");
      const container = getContainer(c);

      // Fetch album data from database
      const result = await container.services.albums.getAlbumData(hashedId);

      if (result.ok) {
        return c.json(result.data, (result.status || 200) as StatusCode);
      }
      const errorResponse: ApiError = {
        error: result.error.message,
        code: result.error.code,
        details: result.error.details,
      };
      return c.json(errorResponse, (result.status || 400) as StatusCode);
    }
  );

  return router;
};
