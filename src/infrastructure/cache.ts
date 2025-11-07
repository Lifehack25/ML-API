/**
 * Edge cache utilities using Cloudflare Workers Cache API
 *
 * Provides simple caching functions with TTL support and cache key tracking
 * for invalidation purposes.
 */

import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * Cache configuration options
 */
export interface CacheOptions {
  ttlSeconds: number;
  headers?: Record<string, string>;
}

/**
 * Generate a cache request object from a cache key
 * Uses a dummy hostname since Workers Cache API requires Request objects
 */
function getCacheRequest(cacheKey: string): Request {
  return new Request(`https://cache.memorylocks.internal/${cacheKey}`, {
    method: 'GET'
  });
}

/**
 * Get a cached response by key
 *
 * @param cacheKey - Unique cache identifier
 * @returns Cached response if found, undefined otherwise
 */
export async function cacheGet(cacheKey: string): Promise<Response | undefined> {
  try {
    const request = getCacheRequest(cacheKey);
    const cache = (caches as any).default as Cache;
    const cached = await cache.match(request);
    return cached;
  } catch (error) {
    console.error('Cache get error:', error);
    return undefined;
  }
}

/**
 * Store a response in cache with TTL
 *
 * @param cacheKey - Unique cache identifier
 * @param data - Data to cache (will be JSON stringified)
 * @param options - Cache configuration (TTL, headers)
 */
export async function cachePut(
  cacheKey: string,
  data: unknown,
  options: CacheOptions
): Promise<void> {
  try {
    const request = getCacheRequest(cacheKey);

    const response = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${options.ttlSeconds}`,
        'X-Cache': 'MISS',
        ...options.headers
      }
    });

    const cache = (caches as any).default as Cache;
    await cache.put(request, response);
  } catch (error) {
    console.error('Cache put error:', error);
    // Don't throw - caching failures shouldn't break the application
  }
}

/**
 * Delete a specific cache entry
 *
 * @param cacheKey - Cache key to delete
 * @returns True if deleted, false otherwise
 */
export async function cacheDelete(cacheKey: string): Promise<boolean> {
  try {
    const request = getCacheRequest(cacheKey);
    const cache = (caches as any).default as Cache;
    return await cache.delete(request);
  } catch (error) {
    console.error('Cache delete error:', error);
    return false;
  }
}

/**
 * Generate cache key for album view (same for owner and public)
 */
export function getCacheKeyAlbum(hashedId: string): string {
  return `album:${hashedId}`;
}

/**
 * Add cache hit/miss header to response
 */
export function addCacheHeader(response: Response, hit: boolean): Response {
  const cloned = new Response(response.body, response);
  cloned.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return cloned;
}
