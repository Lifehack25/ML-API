/**
 * Cache invalidation utilities
 *
 * Simple direct cache purging without KV tracking.
 */

import { cacheDelete } from './cache';

/**
 * Invalidate album cache by hashed ID
 *
 * Directly deletes the cache entry for the specified album.
 * No KV tracking needed since we use a single cache key per album.
 *
 * @param hashedId - Hashed lock identifier
 */
export async function invalidateAlbumCache(hashedId: string): Promise<void> {
  try {
    const cacheKey = `album:${hashedId}`;
    const deleted = await cacheDelete(cacheKey);

    if (deleted) {
      console.log(`Successfully invalidated cache for album ${hashedId}`);
    } else {
      console.log(`No cache entry found for album ${hashedId}`);
    }
  } catch (error) {
    console.error(`Error invalidating cache for album ${hashedId}:`, error);
    // Don't throw - invalidation failures shouldn't break the application
  }
}
