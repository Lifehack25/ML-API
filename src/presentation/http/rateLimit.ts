import type { Context, Next } from "hono";
import type { EnvBindings } from "../../common/bindings";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
  onLimitReached?: (c: Context) => Response;
}

/**
 * Default key generator: uses IP address from Cloudflare headers
 * Falls back to X-Forwarded-For and finally "unknown" if no IP found
 */
const defaultKey = (c: Context): string => {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For") ??
    "unknown";

  return `ip:${ip}`;
};

/**
 * Default rate limit exceeded handler
 * Returns 429 with standard Memory Locks error envelope
 */
const defaultHandler = (c: Context): Response =>
  c.json(
    {
      Success: false,
      Message: "Rate limit exceeded. Please try again later.",
      Code: "RATE_LIMIT_EXCEEDED",
    },
    429
  );

/**
 * Creates a rate limiting middleware using Cloudflare Durable Objects.
 * This provides distributed, consistent rate limiting across all edge locations.
 *
 * @param config - Rate limit configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/*', rateLimit({ windowMs: 60_000, maxRequests: 100 }))
 * ```
 */
export const rateLimit = (config: RateLimitConfig) => {
  const keyFn = config.keyGenerator ?? defaultKey;
  const limitHandler = config.onLimitReached ?? defaultHandler;

  return async (c: Context, next: Next) => {
    const env = c.env as EnvBindings;

    // Generate unique key for this client (IP, user ID, etc.)
    const key = keyFn(c);

    // Get Durable Object ID from the key (consistent hashing)
    const id = env.RATE_LIMITER.idFromName(key);

    // Get stub to the Durable Object instance
    const stub = env.RATE_LIMITER.get(id) as any;

    // Check rate limit by calling the Durable Object
    const result = await stub.checkLimit(config.windowMs, config.maxRequests);

    // Set rate limit headers for client visibility
    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(result.resetTime / 1000).toString());

    // Block if limit exceeded
    if (!result.allowed) {
      return limitHandler(c);
    }

    await next();
  };
};

/**
 * Pre-configured rate limiters for different endpoint types.
 * Use these for consistent rate limiting across the API.
 */
export const rateLimiters = {
  /** 10 requests per minute - for media uploads */
  mediaUpload: rateLimit({ windowMs: 60_000, maxRequests: 10 }),

  /** 60 requests per minute - for general API endpoints */
  api: rateLimit({ windowMs: 60_000, maxRequests: 60 }),

  /** 120 requests per minute - for read-heavy endpoints */
  read: rateLimit({ windowMs: 60_000, maxRequests: 120 }),

  /** 5 requests per minute - for expensive batch operations */
  batch: rateLimit({ windowMs: 60_000, maxRequests: 5 }),

  /** 10 requests per 5 minutes - for auth endpoints (prevent brute force) */
  auth: rateLimit({ windowMs: 300_000, maxRequests: 10 }),
};
