/**
 * Purge specific album URLs from Cloudflare's Cache API
 * Deletes cached responses for both regular and owner views
 *
 * @param hashedId - The hashed lock/album ID
 * @returns Promise that resolves when purge is complete
 */
export async function purgeAlbumEdgeCache(
  hashedId: string
): Promise<void> {
  const urls = [
    `https://album.memorylocks.com/?id=${hashedId}`,
    `https://album.memorylocks.com/?id=${hashedId}&isOwner=true`,
  ];

  console.log(`[Cache Purge] Purging ${urls.length} URLs for album ${hashedId}`);

  try {
    const cache = caches.default;
    const deletePromises = urls.map(url =>
      cache.delete(new Request(url, { method: "GET" }))
    );

    const results = await Promise.all(deletePromises);
    const deletedCount = results.filter(Boolean).length;

    console.log(`[Cache Purge] Successfully purged ${deletedCount}/${urls.length} cached entries for album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Purge] Error purging album ${hashedId}:`, error);
    throw error;
  }
}
