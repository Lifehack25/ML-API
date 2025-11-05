import type { D1Result } from "./types";
import { getTransactionDb } from "../transaction";

export interface CleanupJobRow {
  id: number;
  cloudflare_id: string;
  media_type: "image" | "video";
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  status: "pending" | "completed" | "failed";
  created_at: string;
  updated_at: string;
}

export interface CreateCleanupJobRequest {
  cloudflare_id: string;
  media_type: "image" | "video";
}

export class CleanupJobRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Schedule a new cleanup job for a Cloudflare media asset.
   * Should be called when media deletion fails or within a transaction when deleting from DB.
   */
  async create(request: CreateCleanupJobRequest, txDb?: D1Database): Promise<CleanupJobRow> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();

    // Check for duplicate (idempotency)
    const existing = await this.findByCloudflareId(request.cloudflare_id, db);
    if (existing && existing.status === "pending") {
      return existing; // Already scheduled
    }

    const result: D1Result = await db
      .prepare(
        `INSERT INTO cloudflare_cleanup_jobs (
          cloudflare_id, media_type, retry_count, next_retry_at, status, created_at, updated_at
        ) VALUES (?, ?, 0, datetime('now', '+1 minute'), 'pending', ?, ?)`
      )
      .bind(request.cloudflare_id, request.media_type, now, now)
      .run();

    if (!result.success) {
      throw new Error("Failed to create cleanup job");
    }

    const created = await this.findById(result.meta.last_row_id!, db);
    if (!created) {
      throw new Error("Failed to load created cleanup job");
    }

    return created;
  }

  async findById(id: number, txDb?: D1Database): Promise<CleanupJobRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("SELECT * FROM cloudflare_cleanup_jobs WHERE id = ?")
      .bind(id)
      .first<CleanupJobRow>();

    return result ?? null;
  }

  async findByCloudflareId(cloudflareId: string, txDb?: D1Database): Promise<CleanupJobRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("SELECT * FROM cloudflare_cleanup_jobs WHERE cloudflare_id = ? ORDER BY id DESC LIMIT 1")
      .bind(cloudflareId)
      .first<CleanupJobRow>();

    return result ?? null;
  }

  /**
   * Get pending cleanup jobs that are ready for processing (next_retry_at <= now).
   */
  async getPendingJobs(limit = 100, txDb?: D1Database): Promise<CleanupJobRow[]> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<CleanupJobRow> = await db
      .prepare(
        `SELECT * FROM cloudflare_cleanup_jobs
         WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .bind(limit)
      .all();

    if (!result.success) {
      throw new Error("Failed to fetch pending cleanup jobs");
    }

    return result.results;
  }

  /**
   * Mark a cleanup job as completed.
   */
  async markCompleted(id: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();
    const result = await db
      .prepare("UPDATE cloudflare_cleanup_jobs SET status = 'completed', updated_at = ? WHERE id = ?")
      .bind(now, id)
      .run();

    if (!result.success) {
      throw new Error("Failed to mark cleanup job as completed");
    }
  }

  /**
   * Mark a cleanup job as failed with error message and schedule next retry.
   * Uses exponential backoff: 1m, 5m, 15m, 1h, 6h, 24h
   */
  async markFailedAndScheduleRetry(id: number, error: string, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();

    // Get current retry count
    const job = await this.findById(id, db);
    if (!job) {
      throw new Error("Cleanup job not found");
    }

    const newRetryCount = job.retry_count + 1;
    const maxRetries = 6;

    // Calculate next retry time with exponential backoff
    const retryDelays = [1, 5, 15, 60, 360, 1440]; // minutes
    const delayMinutes = retryDelays[Math.min(newRetryCount - 1, retryDelays.length - 1)];

    if (newRetryCount >= maxRetries) {
      // Permanently failed
      const result = await db
        .prepare(
          `UPDATE cloudflare_cleanup_jobs
           SET status = 'failed', retry_count = ?, last_error = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(newRetryCount, error, now, id)
        .run();

      if (!result.success) {
        throw new Error("Failed to mark cleanup job as permanently failed");
      }
    } else {
      // Schedule retry
      const result = await db
        .prepare(
          `UPDATE cloudflare_cleanup_jobs
           SET retry_count = ?, last_error = ?, next_retry_at = datetime('now', '+${delayMinutes} minutes'), updated_at = ?
           WHERE id = ?`
        )
        .bind(newRetryCount, error, now, id)
        .run();

      if (!result.success) {
        throw new Error("Failed to schedule cleanup job retry");
      }
    }
  }

  /**
   * Get statistics for monitoring.
   */
  async getStats(txDb?: D1Database): Promise<{
    pendingCount: number;
    completedCount: number;
    failedCount: number;
    oldestPending: string | null;
  }> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
           MIN(CASE WHEN status = 'pending' THEN created_at ELSE NULL END) as oldest_pending
         FROM cloudflare_cleanup_jobs`
      )
      .first<{
        pending_count: number;
        completed_count: number;
        failed_count: number;
        oldest_pending: string | null;
      }>();

    return {
      pendingCount: result?.pending_count ?? 0,
      completedCount: result?.completed_count ?? 0,
      failedCount: result?.failed_count ?? 0,
      oldestPending: result?.oldest_pending ?? null,
    };
  }

  /**
   * Delete old completed/failed cleanup jobs (for maintenance).
   */
  async deleteOldJobs(olderThanDays = 30, txDb?: D1Database): Promise<number> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare(
        `DELETE FROM cloudflare_cleanup_jobs
         WHERE status IN ('completed', 'failed')
         AND created_at < datetime('now', '-${olderThanDays} days')`
      )
      .run();

    return result.meta.changes;
  }
}
