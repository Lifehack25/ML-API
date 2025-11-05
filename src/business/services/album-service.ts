import { Logger } from "../../common/logger";
import { failure, ServiceResult, success } from "../../common/result";
import { LockRepository } from "../../data/repositories/lock-repository";
import { MediaObjectRepository } from "../../data/repositories/media-object-repository";
import { mapMediaRowToAlbum } from "../../data/mappers/media-mapper";
import { HashIdHelper } from "../../common/hashids";
import { LockService } from "./lock-service";
import { NotificationService } from "./notification-service";
import { AlbumResponse } from "../dtos/albums";
import { getMilestoneMessage, isSupportedMilestone } from "../constants/milestones";

export class AlbumService {
  constructor(
    private readonly lockRepository: LockRepository,
    private readonly mediaRepository: MediaObjectRepository,
    private readonly lockService: LockService,
    private readonly notificationService: NotificationService,
    private readonly hashids: HashIdHelper,
    private readonly logger: Logger
  ) {}

  async getAlbum(hashedId: string, isOwner: boolean = false): Promise<ServiceResult<AlbumResponse>> {
    if (!hashedId) {
      return failure("INVALID_IDENTIFIER", "Lock identifier is required", undefined, 400);
    }

    // Security: Only hashed IDs are allowed. Numeric IDs expose sequential enumeration vulnerability.
    if (!this.hashids.isHash(hashedId)) {
      return failure("INVALID_IDENTIFIER", "Invalid lock identifier format", undefined, 400);
    }

    const lockId = this.hashids.decode(hashedId);
    if (!lockId) {
      return failure("INVALID_IDENTIFIER", "Invalid lock identifier", undefined, 400);
    }

    let lock = await this.lockRepository.findById(lockId);
    if (!lock) {
      return failure("LOCK_NOT_FOUND", "Album not found", undefined, 404);
    }

    // Only increment scan count for public QR code scans (not owner views)
    if (!isOwner) {
      try {
        const { lock: updatedLock, milestoneReached } = await this.lockRepository.incrementScanCount(lockId);
        lock = updatedLock;

        if (milestoneReached && updatedLock.user_id && isSupportedMilestone(milestoneReached)) {
          const lockName = updatedLock.lock_name?.trim() || "your Memory Lock";
          const message = getMilestoneMessage(milestoneReached, lockName, updatedLock.scan_count);

          if (message) {
            const notificationResult = await this.notificationService.sendNotification({
              userId: updatedLock.user_id,
              title: message.title,
              body: message.body,
              data: {
                lockId: String(lockId),
                scanCount: String(updatedLock.scan_count),
                milestone: String(milestoneReached),
              },
            });

            if (!notificationResult.ok) {
              this.logger.warn("Milestone notification failed", {
                lockId,
                milestone: milestoneReached,
                error: notificationResult.error,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn("Failed to increment scan count", { lockId, error: String(error) });
      }
    }

    const media = await this.mediaRepository.findByLockId(lockId);
    media.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    const dto: AlbumResponse = {
      albumTitle: lock.album_title ?? "Untitled Album",
      sealDate: lock.seal_date ?? null,
      media: media.map(mapMediaRowToAlbum),
    };

    return success(dto);
  }
}
