/**
 * Cache invalidation utilities
 *
 * Simple direct cache purging without KV tracking.
 */

import { cacheDelete } from './cache';

/**
 * Invalidate album cache by hashed ID
 *
 * Deletes both JSON (for MAUI app) and HTML (for web album) cache entries.
 * No KV tracking needed since we use a single cache key per album.
 *
 * @param hashedId - Hashed lock identifier
 */
export async function invalidateAlbumCache(hashedId: string): Promise<void> {
  try {
    const cacheKey = `album:${hashedId}`;

    // Delete JSON cache (for MAUI app API)
    const deletedJson = await cacheDelete(cacheKey);

    // Delete HTML cache (for web album)
    const deletedHtml = await cacheDelete(`${cacheKey}-html`);

    if (deletedJson || deletedHtml) {
      console.log(`Successfully invalidated cache for album ${hashedId} (JSON: ${deletedJson}, HTML: ${deletedHtml})`);
    } else {
      console.log(`No cache entries found for album ${hashedId}`);
    }
  } catch (error) {
    console.error(`Error invalidating cache for album ${hashedId}:`, error);
    // Don't throw - invalidation failures shouldn't break the application
  }
}
