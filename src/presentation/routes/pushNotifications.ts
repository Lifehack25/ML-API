import { Hono } from "hono";
import { z } from "zod";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import type { AppConfig } from "../../config/env";
import { getContainer } from "../http/context";
import { respondFromService } from "../http/responses";
import { createPushNotificationKeyAuth } from "../http/middleware";
import { validateBody } from "../http/validation";

const sendNotificationSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(500),
});

export const createPushNotificationRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();
  const pushKeyAuth = createPushNotificationKeyAuth(config);

  // Send a push notification (admin only - requires Push-Notification-Key header)
  router.post("/send", pushKeyAuth, async (c) => {
    const validation = await validateBody(c, sendNotificationSchema);
    if (!validation.success) return validation.response;

    const result = await getContainer(c).services.notifications.sendNotification(validation.data);
    return respondFromService(c, result);
  });

  return router;
};
