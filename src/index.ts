import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { EnvBindings } from "./common/bindings";
import type { AppVariables } from "./common/context";
import { createRequestContext, type ServiceContainer } from "./common/context";
import { loadConfig, type AppConfig } from "./config/env";
import { requestLogger } from "./presentation/http/middleware";
import { handleError } from "./presentation/http/errors";
import { createSystemRoutes } from "./presentation/routes/system";
import { createUserRoutes } from "./presentation/routes/users";
import { createLockRoutes } from "./presentation/routes/locks";
import { createMediaObjectRoutes } from "./presentation/routes/mediaObjects";
import { createAlbumRoutes } from "./presentation/routes/albums";
import { createPushNotificationRoutes } from "./presentation/routes/pushNotifications";
import { processCleanupJobs } from "./jobs/process-cleanup-jobs";
import { cleanupExpiredIdempotencyKeys } from "./jobs/cleanup-idempotency";

// Export Durable Object for Cloudflare Workers runtime
export { RateLimiter } from "./infrastructure/rateLimit";

let appInstance: Hono<{ Bindings: EnvBindings; Variables: AppVariables }> | null = null;
let cachedConfig: AppConfig | null = null;

const buildApp = (config: AppConfig) => {
  const app = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
    const container: ServiceContainer = createRequestContext(c.env, requestId, config);
    c.set("container", container);
    c.set("requestId", requestId);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";

        // Allow specific web origins for browser-based clients
        const allowedOrigins = [
          "https://album.memorylocks.com",
          // Allow localhost in development for testing
          ...(config.environment === "development" ? ["http://localhost:3000"] : []),
        ];
        return allowedOrigins.includes(origin) ? origin : null;
      },
      allowHeaders: ["Content-Type", "Authorization", "Create-Lock-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );

  app.use("*", secureHeaders());
  app.use("*", requestLogger());

  app.route("/", createSystemRoutes());
  app.route("/users", createUserRoutes(config));
  app.route("/locks", createLockRoutes(config));
  app.route("/media-objects", createMediaObjectRoutes(config));

  const albumRoutes = createAlbumRoutes();
  app.route("/album", albumRoutes);

  app.route("/push-notifications", createPushNotificationRoutes(config));

  app.notFound((c) =>
    c.json(
      {
        Success: false,
        Message: "Endpoint not found",
      },
      404
    )
  );

  app.onError(handleError);

  return app;
};

const getApp = (env: EnvBindings) => {
  if (!appInstance) {
    cachedConfig = loadConfig(env);
    appInstance = buildApp(cachedConfig);
  }
  return appInstance;
};

export default {
  fetch: (request: Request, env: EnvBindings, ctx: ExecutionContext) => {
    const app = getApp(env);
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) {
    try {
      if (event.cron === "0 2 * * *") {
        // Daily at 2 AM UTC: cleanup expired idempotency keys
        await cleanupExpiredIdempotencyKeys(env.DB);
      } else if (event.cron === "*/15 * * * *") {
        // Every 15 minutes: process Cloudflare cleanup jobs
        await processCleanupJobs(env, ctx);
      }
    } catch (error) {
      console.error("Scheduled job failed", { cron: event.cron, error: String(error) });
      throw error; // Re-throw to mark cron execution as failed
    }
  },
};
