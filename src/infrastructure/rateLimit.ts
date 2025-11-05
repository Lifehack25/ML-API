import { DurableObject } from "cloudflare:workers";

/**
 * Rate limiting state for a single key (IP, user, etc.)
 */
interface RateLimitState {
  count: number;
  resetTime: number;
}

/**
 * Durable Object that handles rate limiting for a specific key.
 * Each instance tracks requests for one unique identifier (IP, user ID, etc.)
 * and provides distributed, consistent rate limiting across all edge locations.
 */
export class RateLimiter extends DurableObject {
  /**
   * Check if a request should be allowed based on rate limit configuration.
   * Returns the current state after incrementing the counter.
   *
   * @param windowMs - Time window in milliseconds
   * @param maxRequests - Maximum requests allowed in the window
   * @returns Object with allowed status and current state
   */
  async checkLimit(
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; count: number; resetTime: number; remaining: number }> {
    const now = Date.now();

    // Get current state from storage
    const stateData = await this.ctx.storage.get<RateLimitState>("state");
    let state: RateLimitState;

    if (!stateData || now >= stateData.resetTime) {
      // Create new window
      state = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      // Increment existing window
      state = {
        count: stateData.count + 1,
        resetTime: stateData.resetTime,
      };
    }

    // Save updated state
    await this.ctx.storage.put("state", state);

    const remaining = Math.max(0, maxRequests - state.count);
    const allowed = state.count <= maxRequests;

    return {
      allowed,
      count: state.count,
      resetTime: state.resetTime,
      remaining,
    };
  }

  /**
   * Reset the rate limit state for this key.
   * Useful for testing or manual intervention.
   */
  async reset(): Promise<void> {
    await this.ctx.storage.delete("state");
  }

  /**
   * Get current state without incrementing counter.
   * Useful for monitoring and debugging.
   */
  async getState(): Promise<RateLimitState | null> {
    const state = await this.ctx.storage.get<RateLimitState>("state");
    return state ?? null;
  }
}
