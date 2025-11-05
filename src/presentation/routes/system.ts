import { Hono } from "hono";
import type { Context } from "hono";
import type { EnvBindings } from "../../common/bindings";
import type { AppVariables, ServiceContainer } from "../../common/context";
import { ok } from "../http/responses";

export const createSystemRoutes = () => {
  const router = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

  // Public health check - minimal information exposure
  router.get("/public/health", (c) =>
    ok(c, {
      Status: "Healthy",
      Version: "1.0.0",
    })
  );

  // Root endpoint - public information only
  router.get("/", (c) =>
    ok(c, {
      Service: "ML-API",
      Version: "1.0.0",
      Status: "Running",
    })
  );

  // Kubernetes-style readiness probe with database connectivity check
  router.get("/health/ready", async (c) => {
    try {
      const container = c.get("container") as ServiceContainer;
      // Simple database connectivity test
      await container.db.prepare("SELECT 1").first();

      return ok(c, {
        Status: "Ready",
        Database: "Connected",
        Version: "1.0.0",
      });
    } catch (error) {
      return c.json(
        {
          Success: false,
          Status: "Not Ready",
          Database: "Disconnected",
          Message: "Database connectivity check failed",
        },
        503
      );
    }
  });

  // Kubernetes-style liveness probe
  router.get("/health/live", (c) =>
    ok(c, {
      Status: "Alive",
      Version: "1.0.0",
    })
  );

  return router;
};

