/**
 * Idempotency Service
 *
 * Provides request deduplication to prevent duplicate operations when clients retry requests.
 * Uses D1 database for strongly consistent idempotency key storage with 24-hour TTL.
 *
 * Implementation strategy:
 * - Client supplies Idempotency-Key header (or system generates UUID)
 * - First request: Key reserved in DB, request processed, response cached
 * - Duplicate request: Cached response returned immediately without re-processing
 * - TTL: 24 hours (after which key can be reused)
 *
 * @example
 * ```typescript
 * const service = new IdempotencyService(db);
 *
 * // Check for existing result
 * const existing = await service.checkIdempotency(key, endpoint);
 * if (existing) return existing; // Return cached response
 *
 * // Reserve key before processing
 * await service.reserveKey(key, endpoint, userId);
 *
 * // Process request...
 * const result = await processRequest();
 *
 * // Store result
 * await service.storeResult(key, endpoint, 200, result);
 * ```
 */

export interface IdempotencyRecord {
  idempotencyKey: string;
  endpoint: string;
  userId: number | null;
  responseStatus: number;
  responseBody: string;
  createdAt: string;
  expiresAt: string;
}

export interface CachedResponse {
  status: number;
  body: unknown;
}

export class IdempotencyService {
  constructor(private db: D1Database) {}

  /**
   * Check if an idempotency key already exists and return cached response if found.
   *
   * @param key - Idempotency key (UUID or client-supplied)
   * @param endpoint - Request endpoint path
   * @returns Cached response if key exists and not expired, null otherwise
   */
  async checkIdempotency(key: string, endpoint: string): Promise<CachedResponse | null> {
    const result = await this.db
      .prepare(
        `SELECT response_status, response_body, expires_at
         FROM idempotency_keys
         WHERE idempotency_key = ? AND endpoint = ?`
      )
      .bind(key, endpoint)
      .first<{ response_status: number; response_body: string; expires_at: string }>();

    if (!result) {
      return null;
    }

    // Check expiration
    const now = new Date();
    const expiresAt = new Date(result.expires_at);
    if (now > expiresAt) {
      // Expired - delete and allow reprocessing
      await this.db
        .prepare(`DELETE FROM idempotency_keys WHERE idempotency_key = ? AND endpoint = ?`)
        .bind(key, endpoint)
        .run();
      return null;
    }

    // Return cached response
    return {
      status: result.response_status,
      body: result.response_body ? JSON.parse(result.response_body) : null,
    };
  }

  /**
   * Reserve an idempotency key before processing the request.
   * This prevents duplicate processing if concurrent requests arrive.
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   * @param userId - User ID (optional, for auditing)
   * @throws Error if key already exists (race condition - should retry checkIdempotency)
   */
  async reserveKey(key: string, endpoint: string, userId?: number): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const result = await this.db
      .prepare(
        `INSERT INTO idempotency_keys (idempotency_key, endpoint, user_id, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(key, endpoint, userId ?? null, expiresAt.toISOString())
      .run();

    if (!result.success) {
      throw new Error(`Failed to reserve idempotency key: ${key}`);
    }
  }

  /**
   * Store the result of a processed request for future idempotent responses.
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   * @param status - HTTP status code
   * @param body - Response body (will be JSON serialized)
   */
  async storeResult(key: string, endpoint: string, status: number, body: unknown): Promise<void> {
    const result = await this.db
      .prepare(
        `UPDATE idempotency_keys
         SET response_status = ?, response_body = ?, updated_at = CURRENT_TIMESTAMP
         WHERE idempotency_key = ? AND endpoint = ?`
      )
      .bind(status, JSON.stringify(body), key, endpoint)
      .run();

    if (!result.success) {
      throw new Error(`Failed to store idempotency result for key: ${key}`);
    }
  }

  /**
   * Delete an idempotency key (useful for testing or manual cleanup).
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   */
  async deleteKey(key: string, endpoint: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM idempotency_keys WHERE idempotency_key = ? AND endpoint = ?`)
      .bind(key, endpoint)
      .run();
  }

  /**
   * Clean up expired idempotency keys.
   * Should be called periodically (e.g., via cron trigger).
   *
   * @param batchSize - Maximum number of keys to delete in one call (default: 1000)
   * @returns Number of keys deleted
   */
  async cleanupExpired(batchSize: number = 1000): Promise<number> {
    const result = await this.db
      .prepare(
        `DELETE FROM idempotency_keys
         WHERE expires_at < datetime('now')
         LIMIT ?`
      )
      .bind(batchSize)
      .run();

    return result.meta.changes;
  }

  /**
   * Get statistics about idempotency key usage (for monitoring).
   *
   * @returns Object with total keys, expired keys, and keys by status
   */
  async getStats(): Promise<{
    totalKeys: number;
    expiredKeys: number;
    keysWithResponse: number;
  }> {
    const stats = await this.db
      .prepare(
        `SELECT
           COUNT(*) as total_keys,
           SUM(CASE WHEN expires_at < datetime('now') THEN 1 ELSE 0 END) as expired_keys,
           SUM(CASE WHEN response_body IS NOT NULL THEN 1 ELSE 0 END) as keys_with_response
         FROM idempotency_keys`
      )
      .first<{ total_keys: number; expired_keys: number; keys_with_response: number }>();

    return {
      totalKeys: stats?.total_keys ?? 0,
      expiredKeys: stats?.expired_keys ?? 0,
      keysWithResponse: stats?.keys_with_response ?? 0,
    };
  }
}

/**
 * Generate a UUID v4 idempotency key.
 * Uses Web Crypto API for cryptographically secure random values.
 *
 * @returns UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateIdempotencyKey(): string {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is any hexadecimal digit and y is one of 8, 9, A, or B
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  // Set version (4) and variant (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC4122

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
