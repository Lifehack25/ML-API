// KV-based Rate Limiting Service

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  resetTime: number;
  remaining: number;
}

export class RateLimitService {
  constructor(private kv: KVNamespace) {}

  /**
   * Check if a request should be allowed based on rate limit configuration.
   *
   * @param key - Unique identifier (e.g., "ip:1.2.3.4", "user:123")
   * @param windowMs - Time window in milliseconds
   * @param maxRequests - Maximum requests allowed in the window
   * @returns Result with allowed status and current state
   */
  async checkLimit(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetTime = windowStart + windowMs;

    // Build KV key: ratelimit:{identifier}:{windowStart}
    const kvKey = this.buildKvKey(key, windowStart);

    // Get current count (optimistic read)
    const currentCount = await this.kv.get(kvKey);
    const count = currentCount ? parseInt(currentCount, 10) + 1 : 1;

    // Check if limit would be exceeded
    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);

    // Store updated count with TTL (windowMs + 60s buffer for cleanup)
    const ttlSeconds = Math.ceil((windowMs + 60000) / 1000);
    await this.kv.put(kvKey, count.toString(), {
      expirationTtl: ttlSeconds,
    });

    return {
      allowed,
      count,
      resetTime,
      remaining,
    };
  }

  /**
   * Reset the rate limit for a specific key (useful for testing).
   *
   * @param key - Unique identifier to reset
   */
  async reset(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const kvKey = this.buildKvKey(key, windowStart);
    await this.kv.delete(kvKey);
  }

  /**
   * Build KV key from identifier and window start.
   * Format: ratelimit:{identifier}:{windowStart}
   *
   * @param key - Unique identifier (e.g., "ip:1.2.3.4")
   * @param windowStart - Unix timestamp of window start
   * @returns KV key string
   */
  private buildKvKey(key: string, windowStart: number): string {
    return `ratelimit:${key}:${windowStart}`;
  }
}
