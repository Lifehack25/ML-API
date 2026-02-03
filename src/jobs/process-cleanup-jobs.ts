import type { EnvBindings } from '../common/bindings';
import { CleanupJobRepository } from '../data/repositories/cleanup-job-repository';
import { createCloudflareMediaClient } from '../infrastructure/cloudflare-media';
import { loadConfig } from '../config/env';
import { createLogger } from '../common/logger';
import { createDrizzleClient } from '../data/db';

/**
 * Processes pending Cloudflare cleanup jobs with exponential backoff retry logic.
 * Runs every 12 hours via cron trigger.
 */
export async function processCleanupJobs(env: EnvBindings, _ctx: ExecutionContext): Promise<void> {
  const logger = createLogger('cleanup-jobs');
  const config = loadConfig(env);
  const db = createDrizzleClient(env.DB);
  const cleanupJobRepo = new CleanupJobRepository(db);
  const cloudflareClient = createCloudflareMediaClient(config.cloudflareMedia);

  try {
    // Get pending jobs ready for processing
    const jobs = await cleanupJobRepo.getPendingJobs(50);
    logger.info(`Processing ${jobs.length} cleanup jobs`);

    if (jobs.length === 0) {
      return; // No work to do
    }

    // Process each job
    for (const job of jobs) {
      try {
        logger.info(
          `Attempting to clean up ${job.media_type} ${job.cloudflare_id} (attempt ${job.retry_count + 1})`
        );

        // Attempt Cloudflare deletion
        const success =
          job.media_type === 'image'
            ? await cloudflareClient.deleteImage(job.cloudflare_id)
            : await cloudflareClient.deleteVideo(job.cloudflare_id);

        if (success) {
          await cleanupJobRepo.markCompleted(job.id);
          logger.info(`Successfully cleaned up ${job.media_type} ${job.cloudflare_id}`);
        } else {
          const errorMsg = 'Cloudflare API returned false';
          await cleanupJobRepo.markFailedAndScheduleRetry(job.id, errorMsg);
          logger.warn(`Failed to clean up ${job.media_type} ${job.cloudflare_id}: ${errorMsg}`);
        }
      } catch (error) {
        const errorMsg = String(error);
        await cleanupJobRepo.markFailedAndScheduleRetry(job.id, errorMsg);
        logger.error(`Exception during cleanup of ${job.media_type} ${job.cloudflare_id}`, {
          error: errorMsg,
        });
      }
    }

    // Log stats after processing
    const stats = await cleanupJobRepo.getStats();
    logger.info('Cleanup job stats', {
      pending: stats.pendingCount,
      completed: stats.completedCount,
      failed: stats.failedCount,
      oldestPending: stats.oldestPending,
    });
  } catch (error) {
    logger.error('Fatal error in cleanup job processor', { error: String(error) });
    throw error; // Re-throw to mark cron execution as failed
  }
}
