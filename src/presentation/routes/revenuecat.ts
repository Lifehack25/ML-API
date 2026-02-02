import { Hono } from "hono";
import type { Context } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables } from "../../common/context";
import type { AppConfig } from "../../config/env";
import type { ApiError } from "../http/responses";
import { getContainer } from "../http/context";
import { createRevenueCatWebhookAuth } from "../http/middleware";
import type { RevenueCatWebhookPayload } from "../../services/dtos/revenuecat";

export const createRevenueCatRoutes = (config: AppConfig) => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();
  const webhookAuth = createRevenueCatWebhookAuth(config);

  /**
   * RevenueCat webhook endpoint.
   *
   * Receives purchase events from RevenueCat and processes them.
   *
   * Security:
   * - Authorization header validation (webhook auth key)
   * - User ownership verification
   * - Idempotent processing (checking current state before update)
   *
   * Event types processed:
   * - INITIAL_PURCHASE: First-time subscription or one-time purchase
   * - NON_RENEWING_PURCHASE: One-time consumable purchase
   *
   * Ignored event types:
   * - RENEWAL, CANCELLATION, EXPIRATION, etc. (not relevant for one-time purchases)
   */
  router.post(
    "/webhooks/revenuecat",
    webhookAuth,
    async (c: Context<{ Bindings: EnvBindings; Variables: AppVariables }>) => {
      try {
        const container = getContainer(c);
        const logger = container.logger;

        // Parse webhook payload
        let payload: RevenueCatWebhookPayload;
        try {
          payload = await c.req.json();
        } catch (error) {
          logger.error("Failed to parse RevenueCat webhook payload", { error: String(error) });
          return c.json({ error: "Invalid JSON payload" } as ApiError, 400);
        }

        // Log webhook receipt
        logger.info("RevenueCat webhook received", {
          eventType: payload.event?.type,
          eventId: payload.event?.id,
          productId: payload.event?.product_id,
        });

        // Process webhook via service
        const result = await container.services.revenueCat.processWebhook(payload);

        if (result.ok) {
          // Return 200 OK to acknowledge receipt
          return c.json({ success: true, message: result.message }, 200);
        } else {
          // Return error status
          const errorResponse: ApiError = {
            error: result.error.message,
            code: result.error.code,
            details: result.error.details,
          };
          return c.json(errorResponse, result.status ?? 400);
        }
      } catch (error) {
        const logger = getContainer(c).logger;
        logger.error("Unexpected error in RevenueCat webhook handler", { error: String(error) });
        return c.json({ error: "Internal server error" } as ApiError, 500);
      }
    }
  );

  return router;
};
