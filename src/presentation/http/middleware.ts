import type { Context, MiddlewareHandler } from 'hono';
import type { AppConfig } from '../../config/env';
import type { ApiError } from './responses';

/**
 * Middleware that extracts the userId from the JWT payload and stores it in the context.
 * Must be used after jwt() middleware.
 *
 * Usage: router.use("/protected/*", jwtMiddleware, setUserContext());
 */
export const setUserContext = (): MiddlewareHandler => {
  return async (c, next) => {
    const payload = c.get('jwtPayload') as { userId?: number } | undefined;
    if (!payload?.userId) {
      return c.json({ error: 'User identifier missing from token' } as ApiError, 401);
    }
    c.set('userId', Number(payload.userId));
    return await next();
  };
};

export const createLockKeyAuth = (config: AppConfig): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header('Create-Lock-Key');
    if (!header || header.trim() !== config.createLockApiKey) {
      return c.json({ error: 'Invalid create-lock API key' } as ApiError, 401);
    }
    return await next();
  };
};

export const createPushNotificationKeyAuth = (config: AppConfig): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header('Push-Notification-Key');
    if (!header || header.trim() !== config.pushNotificationKey) {
      return c.json({ error: 'Invalid push notification API key' } as ApiError, 401);
    }
    return await next();
  };
};

export const requestLogger = (): MiddlewareHandler => {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const container = c.get('container');
    if (container?.logger) {
      container.logger.info(`${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
    } else {
      console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
    }
  };
};

export const allowPublic = (
  predicate: (c: Context) => boolean,
  middleware: MiddlewareHandler
): MiddlewareHandler => {
  return async (c, next) => {
    if (predicate(c)) {
      return await next();
    }
    return await middleware(c, next);
  };
};

/**
 * Idempotency middleware for preventing duplicate request processing.
 *
 * Checks for existing idempotency key and returns cached response if found.
 * Otherwise, processes the request and caches the response.
 *
 * REQUIRES client to send Idempotency-Key header. Returns 400 if missing.
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
  const container = c.get('container');
  const idempotencyService = container.idempotencyService;

  // Require client to provide idempotency key
  const key = c.req.header('Idempotency-Key');
  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' } as ApiError, 400);
  }

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
      console.error('Failed to store idempotency result', { key, endpoint, error });
    }
  }
};

/**
 * RevenueCat webhook authentication middleware.
 *
 * Validates the Authorization header against configured webhook auth key.
 *
 * Usage:
 * ```typescript
 * app.post("/webhooks/revenuecat", revenueCatWebhookAuth(config), async (c) => {
 *   // Handler logic
 * });
 * ```
 */
export const createRevenueCatWebhookAuth = (config: AppConfig): MiddlewareHandler => {
  return async (c, next) => {
    if (!config.revenueCat) {
      return c.json({ error: 'RevenueCat not configured' } as ApiError, 503);
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Authorization header required' } as ApiError, 401);
    }

    // RevenueCat sends: Authorization: Bearer <webhook_auth_key>
    // We accept both "Bearer <key>" and just "<key>" for flexibility
    const providedKey = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : authHeader.trim();

    if (providedKey !== config.revenueCat.webhookAuthKey) {
      return c.json({ error: 'Invalid webhook authorization' } as ApiError, 401);
    }

    return await next();
  };
};
