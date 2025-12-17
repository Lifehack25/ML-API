/**
 * Purge specific album URLs from both Cloudflare's global CDN and datacenter-local cache
 * Deletes cached responses for both regular and owner views
 *
 * Uses Cloudflare's Purge API to clear global CDN cache across all edge locations,
 * and also purges the local datacenter cache for immediate effect.
 *
 * @param hashedId - The hashed lock/album ID
 * @param zoneId - The Cloudflare Zone ID for memorylocks.com
 * @param purgeToken - API token with Cache Purge permission
 * @returns Promise that resolves when purge is complete
 */
export async function purgeAlbumEdgeCache(
  hashedId: string,
  zoneId: string,
  purgeToken: string
): Promise<void> {
  const urls = [
    `https://album.memorylocks.com/?id=${hashedId}`,
    `https://album.memorylocks.com/?id=${hashedId}&isOwner=true`,
  ];

  console.log(`[Cache Purge] Purging ${urls.length} URLs from global CDN for album ${hashedId}`);

  try {
    // Purge from global CDN using Cloudflare API
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${purgeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: urls })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloudflare API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    console.log(`[Cache Purge] Global CDN purge response:`, result);

    // Also purge local datacenter cache
    const cache = caches.default;
    const deletePromises = urls.map(url =>
      cache.delete(new Request(url, { method: "GET" }))
    );

    const results = await Promise.all(deletePromises);
    const deletedCount = results.filter(Boolean).length;

    console.log(`[Cache Purge] Successfully purged global CDN and ${deletedCount}/${urls.length} local cache entries for album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Purge] Error purging album ${hashedId}:`, error);
    throw error;
  }
}
