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

export interface CachedResponse {
  status: number;
  body: unknown;
}

interface StoredValue {
  status: number;
  body: unknown;
}

export class IdempotencyService {
  private static readonly TTL_SECONDS = 900; // 15 minutes

  constructor(private kv: KVNamespace) {}

  /**
   * Check if an idempotency key already exists and return cached response if found.
   *
   * @param key - Idempotency key (UUID or client-supplied)
   * @param endpoint - Request endpoint path
   * @returns Cached response if key exists, null otherwise
   */
  async checkIdempotency(key: string, endpoint: string): Promise<CachedResponse | null> {
    const kvKey = this.buildKvKey(key, endpoint);
    const cached = await this.kv.get<StoredValue>(kvKey, "json");

    if (!cached) {
      return null;
    }

    return {
      status: cached.status,
      body: cached.body,
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
    const kvKey = this.buildKvKey(key, endpoint);
    const value: StoredValue = { status, body };

    await this.kv.put(kvKey, JSON.stringify(value), {
      expirationTtl: IdempotencyService.TTL_SECONDS,
    });
  }

  /**
   * Delete an idempotency key (useful for testing or manual cleanup).
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   */
  async deleteKey(key: string, endpoint: string): Promise<void> {
    const kvKey = this.buildKvKey(key, endpoint);
    await this.kv.delete(kvKey);
  }

  /**
   * Build KV key from idempotency key and endpoint.
   * Format: idempotency:{endpoint}:{key}
   *
   * @param key - Idempotency key
   * @param endpoint - Request endpoint path
   * @returns KV key string
   */
  private buildKvKey(key: string, endpoint: string): string {
    // Normalize endpoint by removing leading slash and replacing slashes with colons
    const normalizedEndpoint = endpoint.replace(/^\//, "").replace(/\//g, ":");
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

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
