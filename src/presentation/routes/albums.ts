import { Hono } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import { getContainer } from "../http/context";
import { respondFromService } from "../http/responses";
import { rateLimiters } from "../http/rateLimit";

export const createAlbumRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Public album fetch endpoint.
  router.get("/:hashedId", rateLimiters.read, async (c) => {
    const hashedId = c.req.param("hashedId");
    const isOwner = c.req.query("isOwner") === "true";
    const result = await getContainer(c).services.albums.getAlbum(hashedId, isOwner);
    return respondFromService(c, result);
  });

  return router;
};

