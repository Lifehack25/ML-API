import type { Context, MiddlewareHandler } from "hono";
import type { AppConfig } from "../../config/env";
import { fail } from "./responses";
import { generateIdempotencyKey } from "../../infrastructure/idempotency";

// Rate limiting is now handled by Cloudflare Rate Limiting Rules (configured in Cloudflare Dashboard)
// Previous in-memory rate limiter removed in favor of edge-native solution

/**
 * Middleware that extracts the userId from the JWT payload and stores it in the context.
 * Must be used after jwt() middleware.
 *
 * Usage: router.use("/protected/*", jwtMiddleware, setUserContext());
 */
export const setUserContext = (): MiddlewareHandler => {
  return async (c, next) => {
    const payload = c.get("jwtPayload") as { userId?: number } | undefined;
    if (!payload?.userId) {
      return fail(c, "User identifier missing from token", 401);
    }
    c.set("userId", Number(payload.userId));
    await next();
  };
};

export const createLockKeyAuth = (config: AppConfig): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header("Create-Lock-Key");
    if (!header || header.trim() !== config.createLockApiKey) {
      return c.json({ Success: false, Message: "Invalid create-lock API key" }, 401);
    }
    await next();
  };
};

export const createPushNotificationKeyAuth = (config: AppConfig): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header("Push-Notification-Key");
    if (!header || header.trim() !== config.pushNotificationKey) {
      return c.json({ Success: false, Message: "Invalid push notification API key" }, 401);
    }
    await next();
  };
};

export const requestLogger = (): MiddlewareHandler => {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
  };
};

export const allowPublic = (predicate: (c: Context) => boolean, middleware: MiddlewareHandler): MiddlewareHandler => {
  return async (c, next) => {
    if (predicate(c)) {
      await next();
      return;
    }
    await middleware(c, next);
  };
};

/**
 * Idempotency middleware for preventing duplicate request processing.
 *
 * Checks for existing idempotency key and returns cached response if found.
 * Otherwise, processes the request and caches the response.
 *
 * Key source priority:
 * 1. Idempotency-Key header (client-supplied)
 * 2. Auto-generated UUID v4
 *
 * TTL: 15 minutes
 *
 * Usage:
 * ```typescript
 * app.post("/locks/media", idempotencyMiddleware, async (c) => {
 *   // Handler logic - idempotency automatic
 * });
 * ```
 *
 * IMPORTANT: Do NOT store 5xx server errors (they should be retried).
 */
export const idempotencyMiddleware: MiddlewareHandler = async (c, next) => {
  const container = c.get("container");
  const idempotencyService = container.idempotencyService;

  // Extract or generate idempotency key
  const key = c.req.header("Idempotency-Key") || generateIdempotencyKey();
  const endpoint = c.req.path;

  // Check for existing result
  const cached = await idempotencyService.checkIdempotency(key, endpoint);
  if (cached) {
    // Return cached response immediately
    return c.json(cached.body, cached.status);
  }

  // Process request
  await next();

  // Store result if successful (don't cache 5xx errors - they should be retried)
  const status = c.res.status;
  if (status < 500) {
    try {
      const responseBody = await c.res.clone().json();
      await idempotencyService.storeResult(key, endpoint, status, responseBody);
    } catch (error) {
      // Failed to cache result - log but don't fail the request
      console.error("Failed to store idempotency result", { key, endpoint, error });
    }
  }
};
