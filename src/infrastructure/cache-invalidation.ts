/**
 * Cache invalidation utilities
 *
 * Purges album content from both Cloudflare's global CDN and datacenter-local cache.
 */

import { purgeAlbumEdgeCache } from './cloudflare-purge';

/**
 * Invalidate album cache globally by hashed ID
 *
 * Purges the web album HTML from both Cloudflare's global CDN (across all edge locations)
 * and the datacenter-local cache. The MAUI app does not use edge caching (caching happens client-side).
 *
 * @param hashedId - Hashed lock identifier
 * @param zoneId - Cloudflare Zone ID
 * @param purgeToken - API token with Cache Purge permission
 */
export async function invalidateAlbumCache(
  hashedId: string,
  zoneId: string,
  purgeToken: string
): Promise<void> {
  try {
    // Purge both global CDN and local cache
    await purgeAlbumEdgeCache(hashedId, zoneId, purgeToken);

    console.log(`[Cache Invalidation] Successfully purged global and local cache for album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Invalidation] Error purging cache for album ${hashedId}:`, error);
    // Don't throw - invalidation failures shouldn't break the application
  }
}
