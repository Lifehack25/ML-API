import { eq, and, or, lte, inArray, desc, asc, sql } from 'drizzle-orm';
import type { DrizzleClient } from '../db';
import { cleanupJobs, type CleanupJob } from '../schema';

export interface CreateCleanupJobRequest {
  cloudflare_id: string;
  media_type: 'image' | 'video';
}

export class CleanupJobRepository {
  constructor(private readonly db: DrizzleClient) { }

  /**
   * Schedule a new cleanup job for a Cloudflare media asset.
   * Idempotent: if a job already exists for this cloudflare_id, returns existing job.
   * Uses unique constraint on cloudflare_id to prevent duplicates.
   */
  async create(request: CreateCleanupJobRequest): Promise<CleanupJob> {
    const now = new Date().toISOString();

    // Calculate next retry time (1 minute from now)
    const nextRetryDate = new Date();
    nextRetryDate.setMinutes(nextRetryDate.getMinutes() + 1);
    const nextRetryAt = nextRetryDate.toISOString();

    try {
      // Try to insert - unique constraint prevents duplicates
      const result = await this.db
        .insert(cleanupJobs)
        .values({
          cloudflare_id: request.cloudflare_id,
          media_type: request.media_type,
          retry_count: 0,
          next_retry_at: nextRetryAt,
          status: 'pending',
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (!result[0]) {
        throw new Error('Failed to create cleanup job');
      }

      return result[0];
    } catch (error) {
      // If unique constraint violation, fetch and return existing job
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const existing = await this.findByCloudflareId(request.cloudflare_id);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async findById(id: number): Promise<CleanupJob | null> {
    const result = await this.db.select().from(cleanupJobs).where(eq(cleanupJobs.id, id)).limit(1);

    return result[0] ?? null;
  }

  async findByCloudflareId(cloudflareId: string): Promise<CleanupJob | null> {
    const result = await this.db
      .select()
      .from(cleanupJobs)
      .where(eq(cleanupJobs.cloudflare_id, cloudflareId))
      .orderBy(desc(cleanupJobs.id))
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * Get pending cleanup jobs that are ready for processing (next_retry_at <= now).
   */
  async getPendingJobs(limit = 100): Promise<CleanupJob[]> {
    const now = new Date().toISOString();

    return await this.db
      .select()
      .from(cleanupJobs)
      .where(
        and(
          eq(cleanupJobs.status, 'pending'),
          or(sql`${cleanupJobs.next_retry_at} IS NULL`, lte(cleanupJobs.next_retry_at, now))
        )
      )
      .orderBy(asc(cleanupJobs.created_at))
      .limit(limit);
  }

  /**
   * Mark a cleanup job as completed.
   */
  async markCompleted(id: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(cleanupJobs)
      .set({ status: 'completed', updated_at: now })
      .where(eq(cleanupJobs.id, id));
  }

  /**
   * Mark a cleanup job as failed with error message and schedule next retry.
   * Uses exponential backoff: 1m, 5m, 15m, 1h, 6h, 24h
   */
  async markFailedAndScheduleRetry(id: number, error: string): Promise<void> {
    const now = new Date().toISOString();

    // Get current retry count
    const job = await this.findById(id);
    if (!job) {
      throw new Error('Cleanup job not found');
    }

    const newRetryCount = job.retry_count + 1;
    const maxRetries = 6;

    // Calculate next retry time with exponential backoff
    const retryDelays = [1, 5, 15, 60, 360, 1440]; // minutes
    const delayMinutes = retryDelays[Math.min(newRetryCount - 1, retryDelays.length - 1)];

    if (newRetryCount >= maxRetries) {
      // Permanently failed
      await this.db
        .update(cleanupJobs)
        .set({
          status: 'failed',
          retry_count: sql`${cleanupJobs.retry_count} + 1`,
          last_error: error, // Assuming 'error' is already a string, not an Error object
          updated_at: new Date().toISOString(), // Use ISO string for consistency
        })
        .where(eq(cleanupJobs.id, id))
        .returning();
    } else {
      // Schedule retry
      const nextRetryDate = new Date();
      nextRetryDate.setMinutes(nextRetryDate.getMinutes() + delayMinutes);
      const nextRetryAt = nextRetryDate.toISOString();

      await this.db
        .update(cleanupJobs)
        .set({
          retry_count: newRetryCount,
          last_error: error,
          next_retry_at: nextRetryAt,
          updated_at: now,
        })
        .where(eq(cleanupJobs.id, id));
    }
  }

  /**
   * Get statistics for monitoring.
   */
  async getStats(): Promise<{
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    oldestPending: string | null;
  }> {
    const result = await this.db
      .select({
        pending_count: sql<number>`SUM(CASE WHEN ${cleanupJobs.status} = 'pending' THEN 1 ELSE 0 END)`,
        completed_count: sql<number>`SUM(CASE WHEN ${cleanupJobs.status} = 'completed' THEN 1 ELSE 0 END)`,
        failed_count: sql<number>`SUM(CASE WHEN ${cleanupJobs.status} = 'failed' THEN 1 ELSE 0 END)`,
        oldest_pending: sql<
          string | null
        >`MIN(CASE WHEN ${cleanupJobs.status} = 'pending' THEN ${cleanupJobs.created_at} ELSE NULL END)`,
      })
      .from(cleanupJobs);

    return {
      pendingCount: result[0]?.pending_count ?? 0,
      completedCount: result[0]?.completed_count ?? 0,
      failedCount: result[0]?.failed_count ?? 0,
      oldestPending: result[0]?.oldest_pending ?? null,
    };
  }

  /**
   * Delete old completed/failed cleanup jobs (for maintenance).
   */
  async deleteOldJobs(olderThanDays = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoff = cutoffDate.toISOString();

    await this.db
      .delete(cleanupJobs)
      .where(
        and(
          inArray(cleanupJobs.status, ['completed', 'failed']),
          sql`${cleanupJobs.created_at} < ${cutoff}`
        )
      );

    // Drizzle doesn't return changes count directly, so we'll return 0
    // In production, you might want to query count before deleting if needed
    return 0;
  }
}
