import { Hono } from "hono";
import type { Context } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables, ServiceContainer } from "../../common/context";
import type { ApiError } from "../http/responses";
import { sql } from "drizzle-orm";

export const createSystemRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Public health check - minimal information exposure
  router.get("/public/health", (c) =>
    c.json({
      Status: "Healthy",
      Version: "1.0.0",
    }, 200)
  );

  // Root endpoint - public information only
  router.get("/", (c) =>
    c.json({
      Service: "ML-API",
      Version: "1.0.0",
      Status: "Running",
    }, 200)
  );

  // Kubernetes-style readiness probe with database connectivity check
  router.get("/health/ready", async (c) => {
    try {
      const container = c.get("container") as ServiceContainer;
      // Simple database connectivity test using Drizzle
      await container.db.run(sql`SELECT 1`);

      return c.json({
        Status: "Ready",
        Database: "Connected",
        Version: "1.0.0",
      }, 200);
    } catch (error) {
      return c.json({
        error: "Database connectivity check failed",
        details: {
          Status: "Not Ready",
          Database: "Disconnected",
        }
      } as ApiError, 503);
    }
  });

  // Kubernetes-style liveness probe
  router.get("/health/live", (c) =>
    c.json({
      Status: "Alive",
      Version: "1.0.0",
    }, 200)
  );

  return router;
};

