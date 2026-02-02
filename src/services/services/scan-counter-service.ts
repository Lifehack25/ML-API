/**
 * Scan Counter Service
 *
 * Handles asynchronous scan counting for public album views,
 * allowing the main response to be cached while scan counts
 * are incremented in the background.
 */

import { Logger } from "../../common/logger";
import { LockRepository } from "../../data/repositories/lock-repository";
import { NotificationService } from "./notification-service";
import { getMilestoneMessage, isSupportedMilestone } from "../constants/milestones";

export class ScanCounterService {
  constructor(
    private readonly lockRepository: LockRepository,
    private readonly notificationService: NotificationService,
    private readonly logger: Logger
  ) {}

  /**
   * Increment scan count and send milestone notification if applicable.
   * This function is designed to be called asynchronously via waitUntil()
   * to allow the album response to be cached independently of scan counting.
   *
   * @param lockId - Lock ID to increment scan count for
   */
  async incrementScanAndNotify(lockId: number): Promise<void> {
    try {
      const { lock, milestoneReached } = await this.lockRepository.incrementScanCount(lockId);

      // Check if milestone was reached and notification should be sent
      if (milestoneReached && lock.user_id && isSupportedMilestone(milestoneReached)) {
        const lockName = lock.lock_name?.trim() || "your Memory Lock";
        const message = getMilestoneMessage(milestoneReached, lockName, lock.scan_count);

        if (message) {
          // Send notification (this is already async, but we await to catch errors)
          const notificationResult = await this.notificationService.sendNotification({
            userId: lock.user_id,
            title: message.title,
            body: message.body,
            data: {
              lockId: String(lockId),
              milestone: String(milestoneReached),
            },
          });

          if (!notificationResult.ok) {
            this.logger.warn("Milestone notification failed", {
              lockId,
              milestone: milestoneReached,
              error: notificationResult.error,
            });
          } else {
            this.logger.info("Milestone notification sent successfully", {
              lockId,
              milestone: milestoneReached,
              userId: lock.user_id,
            });
          }
        }
      }

      this.logger.debug("Scan count incremented", {
        lockId,
        newScanCount: lock.scan_count,
        milestoneReached: milestoneReached || "none",
      });
    } catch (error) {
      // Log error but don't throw - we don't want to break the Worker
      // if scan counting fails (the cached response is already returned)
      this.logger.error("Failed to increment scan count", {
        lockId,
        error: String(error),
      });
    }
  }
}
