import type { CloudflarePurgeConfig } from "../config/env";

/**
 * Purge specific album URLs from Cloudflare's edge cache
 * Uses Cloudflare Cache Purge API with limited-scope token
 *
 * @param hashedId - The hashed lock/album ID
 * @param config - Cloudflare purge configuration (zone ID and token)
 * @returns Promise that resolves when purge is complete
 */
export async function purgeAlbumEdgeCache(
  hashedId: string,
  config: CloudflarePurgeConfig
): Promise<void> {
  const urls = [
    `https://album.memorylocks.com/?id=${hashedId}`,
    `https://album.memorylocks.com/?id=${hashedId}&isOwner=true`,
  ];

  console.log(`[Cache Purge] Purging ${urls.length} URLs for album ${hashedId}`);

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: urls }),
      }
    );

    const result = await response.json() as {
      success: boolean;
      errors: Array<{ code: number; message: string }>;
    };

    if (!result.success) {
      const errorMessages = result.errors.map((e) => `[${e.code}] ${e.message}`).join(", ");
      console.error(`[Cache Purge] Failed to purge album ${hashedId}: ${errorMessages}`);
      throw new Error(`Cache purge failed: ${errorMessages}`);
    }

    console.log(`[Cache Purge] Successfully purged album ${hashedId}`);
  } catch (error) {
    console.error(`[Cache Purge] Error purging album ${hashedId}:`, error);
    throw error;
  }
}
