/**
 * Cache invalidation utilities
 *
 * Purges album content from Cloudflare's edge cache using the Cache Purge API.
 */

import { purgeAlbumEdgeCache } from './cloudflare-purge';
import type { CloudflarePurgeConfig } from '../config/env';

/**
 * Invalidate album edge cache by hashed ID
 *
 * Purges the web album HTML from Cloudflare's edge network.
 * The MAUI app does not use edge caching (caching happens client-side).
 *
 * @param hashedId - Hashed lock identifier
 * @param purgeConfig - Cloudflare purge configuration (zone ID and token)
 */
export async function invalidateAlbumCache(
  hashedId: string,
  purgeConfig?: CloudflarePurgeConfig
): Promise<void> {
  try {
    if (!purgeConfig) {
      console.log(`[Cache Invalidation] Cloudflare purge not configured, skipping invalidation for album ${hashedId}`);
      return;
    }

    // Purge edge cache for web album HTML
    await purgeAlbumEdgeCache(hashedId, purgeConfig);

    console.log(`[Cache Invalidation] Successfully purged edge cache for album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Invalidation] Error purging cache for album ${hashedId}:`, error);
    // Don't throw - invalidation failures shouldn't break the application
  }
}
