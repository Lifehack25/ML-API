/**
 * Idempotency Service
 *
 * Provides request deduplication to prevent duplicate operations when clients retry requests.
 * Uses Cloudflare KV for idempotency key storage with 15-minute TTL.
 *
 * Implementation strategy:
 * - Client supplies Idempotency-Key header (or system generates UUID)
 * - First request: Request processed, response cached in KV
 * - Duplicate request: Cached response returned immediately without re-processing
 * - TTL: 15 minutes (after which key expires automatically)
 *
 * This service is part of the ML-API unified edge-native API for Memory Locks.
 *
 * @example
 * ```typescript
 * const service = new IdempotencyService(kv);
 *
 * // Check for existing result
 * const existing = await service.checkIdempotency(key, endpoint);
 * if (existing) return existing; // Return cached response
 *
 * // Process request...
 * const result = await processRequest();
 *
 * // Store result
 * await service.storeResult(key, endpoint, 200, result);
 * ```
 */

import { eq, lt } from 'drizzle-orm';
import type { DrizzleClient } from '../data/db';
import { idempotencyKeys } from '../data/schema';

export interface CachedResponse {
  status: number;
  body: unknown;
}

export class IdempotencyService {
  private static readonly TTL_SECONDS = 900; // 15 minutes

  constructor(private db: DrizzleClient) {}

  /**
   * Check if an idempotency key already exists and return cached response if found.
   *
   * @param key - Idempotency key (UUID or client-supplied)
   * @param endpoint - Request endpoint path
   * @returns Cached response if key exists and is valid, null otherwise
   */
  async checkIdempotency(key: string, endpoint: string): Promise<CachedResponse | null> {
    const dbKey = this.buildKey(key, endpoint);

    const [cached] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, dbKey))
      .limit(1);

    if (!cached) {
      return null;
    }

    // Check if the key has expired (older than 15 minutes)
    // created_at is strictly in ISO8601 UTC format
    const createdAtTime = new Date(cached.created_at + 'Z').getTime();
    if (Date.now() - createdAtTime > IdempotencyService.TTL_SECONDS * 1000) {
      // Expired, let's treat it as not found
      return null;
    }

    return {
      status: cached.status,
      body: cached.body ? JSON.parse(cached.body) : null,
    };
  }

  /**
   * Store the result of a processed request for future idempotent responses.
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   * @param status - HTTP status code
   * @param body - Response body
   */
  async storeResult(key: string, endpoint: string, status: number, body: unknown): Promise<void> {
    const dbKey = this.buildKey(key, endpoint);

    try {
      await this.db
        .insert(idempotencyKeys)
        .values({
          key: dbKey,
          status,
          body: JSON.stringify(body),
        })
        .onConflictDoUpdate({
          target: idempotencyKeys.key,
          set: {
            status,
            body: JSON.stringify(body),
          },
        });
    } catch (e) {
      console.error('Failed to store idempotency result in D1', e);
    }
  }

  /**
   * Delete an idempotency key (useful for testing or manual cleanup).
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   */
  async deleteKey(key: string, endpoint: string): Promise<void> {
    const dbKey = this.buildKey(key, endpoint);
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, dbKey));
  }

  /**
   * Delete keys older than a specific threshold (e.g. 24 hours).
   * Intended to be run periodically via a Cron Trigger.
   */
  async deleteOldKeys(maxAgeSeconds: number = 24 * 60 * 60): Promise<void> {
    const thresholdDate = new Date(Date.now() - maxAgeSeconds * 1000);
    // SQLite uses 'YYYY-MM-DD HH:MM:SS' format for CURRENT_TIMESTAMP
    const thresholdSqlString = thresholdDate.toISOString().replace('T', ' ').substring(0, 19);

    await this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.created_at, thresholdSqlString));
  }

  /**
   * Build database key from idempotency key and endpoint.
   * Format: idempotency:{endpoint}:{key}
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   * @returns DB key string
   */
  private buildKey(key: string, endpoint: string): string {
    // Normalize endpoint by removing leading slash and replacing slashes with colons
    const normalizedEndpoint = endpoint.replace(/^\//, '').replace(/\//g, ':');
    return `idempotency:${normalizedEndpoint}:${key}`;
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

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
