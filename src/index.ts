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
import { createWebAlbumRoutes } from "./presentation/routes/web-album";
import { createPushNotificationRoutes } from "./presentation/routes/pushNotifications";
import { processCleanupJobs } from "./jobs/process-cleanup-jobs";

let appInstance: Hono<{ Bindings: EnvBindings; Variables: AppVariables }> | null = null;
let cachedConfig: AppConfig | null = null;

const buildApp = (config: AppConfig) => {
  const app = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
    const container: ServiceContainer = createRequestContext(c.env, requestId, config);
    c.set("container", container);
    c.set("requestId", requestId);
    c.set("executionCtx", c.executionCtx);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";

        const allowedOrigins = [
          // album.memorylocks.com removed - now same-origin (served by same worker)
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

  // Web album routes for album.memorylocks.com (has access to container middleware above)
  app.route("/", createWebAlbumRoutes());

  // API routes (for api.memorylocks.com and other hosts)
  app.route("/", createSystemRoutes());
  app.route("/users", createUserRoutes(config));
  app.route("/locks", createLockRoutes(config));
  app.route("/media-objects", createMediaObjectRoutes(config));

  app.route("/album", createAlbumRoutes(config));

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
      if (event.cron === "*/15 * * * *") {
        // Every 15 minutes: process Cloudflare cleanup jobs
        await processCleanupJobs(env, ctx);
      }
    } catch (error) {
      console.error("Scheduled job failed", { cron: event.cron, error: String(error) });
      throw error; // Re-throw to mark cron execution as failed
    }
  },
};
