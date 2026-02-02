/**
 * Invalidate album cache locally by hashed ID
 *
 * Purges the web album HTML from the local datacenter cache.
 *
 * @param hashedId - Hashed lock identifier
 */
export async function invalidateAlbumCache(hashedId: string): Promise<void> {
  const urls = [
    `https://album.memorylocks.com/?id=${hashedId}`,
    `https://album.memorylocks.com/?id=${hashedId}&isOwner=true`,
  ];

  console.log(
    `[Cache Invalidation] Purging ${urls.length} URLs from local datacenter cache for album ${hashedId}`
  );

  try {
    // Purge local datacenter cache
    const cache = caches.default;
    const deletePromises = urls.map((url) => cache.delete(new Request(url, { method: 'GET' })));

    const results = await Promise.all(deletePromises);
    const deletedCount = results.filter(Boolean).length;

    console.log(
      `[Cache Invalidation] Successfully purged ${deletedCount}/${urls.length} local cache entries for album ${hashedId}`
    );
  } catch (error) {
    console.error(`[Cache Invalidation] Error purging cache for album ${hashedId}:`, error);
  }
}
