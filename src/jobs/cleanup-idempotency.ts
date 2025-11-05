import { createLogger } from "../common/logger";

/**
 * Deletes expired idempotency keys (24-hour TTL).
 * Runs daily at 2 AM UTC via cron trigger.
 */
export async function cleanupExpiredIdempotencyKeys(db: D1Database): Promise<void> {
  const logger = createLogger("idempotency-cleanup");

  try {
    const result = await db
      .prepare(`DELETE FROM idempotency_keys WHERE expires_at < datetime('now') LIMIT 1000`)
      .run();

    const deletedCount = result.meta.changes;
    logger.info(`Deleted ${deletedCount} expired idempotency keys`);

    // If we hit the limit, there may be more to clean up
    if (deletedCount === 1000) {
      logger.warn("Hit deletion limit of 1000 keys - more expired keys may exist");
    }
  } catch (error) {
    logger.error("Failed to cleanup expired idempotency keys", { error: String(error) });
    throw error; // Re-throw to mark cron execution as failed
  }
}
