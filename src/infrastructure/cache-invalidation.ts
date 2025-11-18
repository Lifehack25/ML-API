/**
 * Cache invalidation utilities
 *
 * Purges album content from Cloudflare's edge cache using the Cache API.
 */

import { purgeAlbumEdgeCache } from './cloudflare-purge';

/**
 * Invalidate album edge cache by hashed ID
 *
 * Purges the web album HTML from Cloudflare's edge cache using Cache API.
 * The MAUI app does not use edge caching (caching happens client-side).
 *
 * @param hashedId - Hashed lock identifier
 */
export async function invalidateAlbumCache(
  hashedId: string
): Promise<void> {
  try {
    // Purge edge cache for web album HTML
    await purgeAlbumEdgeCache(hashedId);

    console.log(`[Cache Invalidation] Successfully purged edge cache for album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Invalidation] Error purging cache for album ${hashedId}:`, error);
    // Don't throw - invalidation failures shouldn't break the application
  }
}
