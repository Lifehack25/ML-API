import type { Context, Next } from "hono";
import type { EnvBindings } from "../../common/bindings";
import { RateLimitService } from "../../infrastructure/rateLimit";

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
 * Creates a rate limiting middleware using Cloudflare KV.
 * Provides distributed rate limiting with eventual consistency.
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

    // Create rate limit service with KV binding
    const rateLimitService = new RateLimitService(env.RATE_LIMIT);

    // Check rate limit
    const result = await rateLimitService.checkLimit(key, config.windowMs, config.maxRequests);

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
  // Authentication - Split by abuse risk level
  /** 5 requests per 5 minutes - for sending verification codes (prevent SMS bombing) */
  authSendCode: rateLimit({ windowMs: 300_000, maxRequests: 5 }),

  /** 15 requests per 5 minutes - for verifying codes (allow retry on typos) */
  authVerify: rateLimit({ windowMs: 300_000, maxRequests: 15 }),

  /** 10 requests per minute - for OAuth verification (low risk, externally validated) */
  authOAuth: rateLimit({ windowMs: 60_000, maxRequests: 10 }),

  // Token operations
  /** 10 requests per minute - for token refresh (should be ~1 per 2 hours normally) */
  tokenRefresh: rateLimit({ windowMs: 60_000, maxRequests: 10 }),

  // Media operations
  /** 120 requests per 5 minutes - for media uploads (allows full Tier 2 album of 100 images + retries) */
  mediaUpload: rateLimit({ windowMs: 300_000, maxRequests: 120 }),

  // General API - Split by operation type
  /** 120 requests per minute - for read operations (cheap, safe) */
  apiRead: rateLimit({ windowMs: 60_000, maxRequests: 120 }),

  /** 30 requests per minute - for write operations (protect DB) */
  apiWrite: rateLimit({ windowMs: 60_000, maxRequests: 30 }),

  // Public endpoints
  /** 300 requests per minute - for public album viewing (support viral growth) */
  albumRead: rateLimit({ windowMs: 60_000, maxRequests: 300 }),

  // Admin operations
  /** 5 requests per minute - for batch lock creation (admin only) */
  batch: rateLimit({ windowMs: 60_000, maxRequests: 5 }),
};
