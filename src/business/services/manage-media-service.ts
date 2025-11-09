import { Logger } from "../../common/logger";
import { failure, ServiceResult, success } from "../../common/result";
import { executeWithRetry } from "../../common/retry";
import { MediaObjectRepository } from "../../data/repositories/media-object-repository";
import type { MediaCreateRequest } from "../../data/repositories/media-object-repository";
import { LockRepository } from "../../data/repositories/lock-repository";
import { CleanupJobRepository } from "../../data/repositories/cleanup-job-repository";
import { mapMediaRowToAlbum, mapMediaRowToCreated } from "../../data/mappers/media-mapper";
import { CloudflareMediaClient } from "../../infrastructure/cloudflare";
import { SightengineClient } from "../../infrastructure/sightengine";
import type { StorageLimits } from "../../config/env";
import { withTransaction, withBatch } from "../../data/transaction";
import {
  CreatedMedia,
  MetadataChange,
  MetadataChangeType,
  PublishMetadataRequest,
  PublishResult,
  UploadMediaPayload,
  ValidationData,
} from "../dtos/locks";

const MAX_IMAGE_BYTES = 15_728_640; // 15 MB

export class ManageMediaService {
  constructor(
    private readonly mediaRepository: MediaObjectRepository,
    private readonly lockRepository: LockRepository,
    private readonly cleanupJobRepository: CleanupJobRepository,
    private readonly cloudflareClient: CloudflareMediaClient,
    private readonly sightengineClient: SightengineClient,
    private readonly logger: Logger,
    private readonly storageLimits: StorageLimits
  ) {}

  private async getValidationData(lockId: number): Promise<ValidationData> {
    const lock = await this.lockRepository.findById(lockId);
    if (!lock) {
      throw new Error("Lock not found");
    }

    const media = await this.mediaRepository.findByLockId(lockId);

    return {
      lock: {
        id: lock.id,
        upgradedStorage: Boolean(lock.upgraded_storage),
      },
      media: media.map((row) => ({
        id: row.id,
        isImage: Boolean(row.is_image),
        isMainImage: Boolean(row.is_main_picture),
        durationSeconds: row.duration_seconds ?? null,
      })),
    };
  }

  private async validateStorage(
    lockId: number,
    isVideo: boolean,
    durationSeconds?: number | null
  ): Promise<ServiceResult<boolean>> {
    try {
      const data = await this.getValidationData(lockId);
      const upgraded = data.lock.upgradedStorage;
      const maxImages = upgraded ? this.storageLimits.tier2ImageLimit : this.storageLimits.tier1ImageLimit;
      const maxVideoSeconds = upgraded ? this.storageLimits.tier2VideoSeconds : this.storageLimits.tier1VideoSeconds;

      const existingMedia = data.media.filter((m) => !m.isMainImage);
      const imageCount = existingMedia.filter((m) => m.isImage).length;
      const videoSeconds = existingMedia.filter((m) => !m.isImage).reduce((sum, m) => sum + (m.durationSeconds ?? 0), 0);

      if (isVideo) {
        if (durationSeconds && durationSeconds > maxVideoSeconds) {
          return failure(
            "VIDEO_TOO_LONG",
            `Video length exceeds ${maxVideoSeconds} seconds limit`,
            undefined,
            400
          );
        }

        const total = videoSeconds + (durationSeconds ?? 0);
        if (total > maxVideoSeconds) {
          const message = upgraded
            ? `Maximum video storage reached (${maxVideoSeconds}s limit)`
            : `Video storage limit reached. Upgrade to Tier 2 for ${this.storageLimits.tier2VideoSeconds}s total video.`;
          return failure(upgraded ? "TIER_LIMIT" : "UPGRADE_REQUIRED", message, undefined, 400);
        }
      } else {
        if (imageCount >= maxImages) {
          const message = upgraded
            ? `Maximum image storage reached (${maxImages} images limit)`
            : `Image storage limit reached. Upgrade to Tier 2 for ${this.storageLimits.tier2ImageLimit} images.`;
          return failure(upgraded ? "TIER_LIMIT" : "UPGRADE_REQUIRED", message, undefined, 400);
        }
      }

      this.logger.info("Storage validation passed", {
        lockId,
        imageCount,
        videoSeconds,
        maxImages,
        maxVideoSeconds,
      });

      return success(true);
    } catch (error) {
      this.logger.error("Storage validation error", { lockId, error: String(error) });
      return failure("VALIDATION_FAILED", "Unable to validate storage limits", undefined, 500);
    }
  }

  async uploadSingleMedia(payload: UploadMediaPayload): Promise<ServiceResult<CreatedMedia>> {
    const { lockId, file, displayOrder, isMainImage, durationSeconds } = payload;

    if (!file) {
      return failure("NO_FILE", "No file provided", undefined, 400);
    }

    if (!lockId || Number.isNaN(lockId)) {
      return failure("INVALID_LOCK", "Invalid lockId", undefined, 400);
    }

    const isVideo = file.type.startsWith("video/");
    const maxVideoBytes = this.storageLimits.maxVideoSizeMB * 1_048_576; // Convert MB to bytes

    // Validate file size
    if (isVideo && file.size > maxVideoBytes) {
      return failure(
        "VIDEO_TOO_LARGE",
        `Video file size exceeds ${this.storageLimits.maxVideoSizeMB}MB limit`,
        undefined,
        400
      );
    }

    if (!isVideo && file.size > MAX_IMAGE_BYTES) {
      return failure("IMAGE_TOO_LARGE", "Image file size exceeds 15MB limit", undefined, 400);
    }

    const validation = await this.validateStorage(lockId, isVideo, durationSeconds);
    if (!validation.ok) {
      return validation;
    }

    const moderation = isVideo
      ? await this.sightengineClient.moderateVideo(file)
      : await this.sightengineClient.moderateImage(file);

    if (!moderation.approved) {
      return failure("MODERATION_REJECTED", moderation.rejectionReason ?? "Content rejected", undefined, 400);
    }

    // If moderation used compression, log it but still upload original for best quality
    if (moderation.compressedImage) {
      this.logger.info("Moderation used compression, but uploading original for better quality", {
        originalSize: file.size,
        compressedSize: moderation.compressedImage.size,
      });
    }

    // Always upload original file for best quality - Cloudflare will optimize at delivery
    const uploadResult = isVideo
      ? await this.cloudflareClient.uploadVideo(file)
      : await this.cloudflareClient.uploadImage(file);

    if (!uploadResult.success || !uploadResult.url || !uploadResult.cloudflareId) {
      return failure("UPLOAD_FAILED", uploadResult.error ?? "Failed to upload media", undefined, 502);
    }

    const durationToPersist = uploadResult.durationSeconds ?? durationSeconds;

    const mediaRequest: MediaCreateRequest = {
      lock_id: lockId,
      cloudflare_id: uploadResult.cloudflareId,
      url: uploadResult.url,
      thumbnail_url: uploadResult.thumbnailUrl ?? null,
      file_name: file.name,
      is_image: !isVideo,
      is_main_picture: isMainImage,
      display_order: displayOrder,
    };

    if (durationToPersist !== undefined) {
      mediaRequest.duration_seconds = durationToPersist;
    }

    // Compensating transaction: If DB fails, schedule Cloudflare cleanup
    try {
      const created = await this.mediaRepository.create(mediaRequest);
      const dto = mapMediaRowToCreated(created);
      return success(dto, "Media uploaded successfully");
    } catch (dbError) {
      this.logger.error("Database insert failed after Cloudflare upload - scheduling cleanup", {
        cloudflareId: uploadResult.cloudflareId,
        error: String(dbError),
      });

      // Schedule cleanup job (best-effort - don't fail the request if this fails)
      try {
        await this.cleanupJobRepository.create({
          cloudflare_id: uploadResult.cloudflareId,
          media_type: isVideo ? "video" : "image",
        });
      } catch (cleanupError) {
        this.logger.error("Failed to schedule cleanup job", { error: String(cleanupError) });
      }

      return failure("DB_INSERT_FAILED", "Failed to save media metadata", undefined, 500);
    }
  }

  // Publish the metadata of the media
  async publishMetadata(request: PublishMetadataRequest): Promise<ServiceResult<PublishResult>> {
    const { lockId, changes, albumTitle } = request;

    if (!lockId) {
      return failure("INVALID_LOCK", "lockId is required", undefined, 400);
    }

    this.logger.info("Starting album publish", {
      lockId,
      changeCount: changes.length,
    });

    // Group changes by type for optimized processing
    const deletes = changes.filter((c) => c.changeType === MetadataChangeType.Delete);
    const reorders = changes.filter((c) => c.changeType === MetadataChangeType.Reorder);
    const mainImageUpdates = changes.filter((c) => c.changeType === MetadataChangeType.UpdateMainImage);

    try {
      // Collect all data before starting the batch transaction
      const cleanupList: Array<{ cloudflare_id: string; media_type: "image" | "video" }> = [];

      // 1. Fetch media info for deletions (need Cloudflare IDs for cleanup)
      if (deletes.length > 0) {
        this.logger.info("Collecting deletion metadata", { count: deletes.length });

        for (const change of deletes) {
          if (!change.mediaId) {
            throw new Error("mediaId is required for delete");
          }

          // Fetch media to get Cloudflare ID before deletion
          const media = await this.mediaRepository.findById(change.mediaId);
          if (media && media.cloudflare_id) {
            cleanupList.push({
              cloudflare_id: media.cloudflare_id,
              media_type: media.is_image ? "image" : "video",
            });
          }
        }
      }

      // 2. Execute all DB operations atomically using batch API
      await withBatch(this.lockRepository["db"], (batch) => {
        // Delete media objects
        for (const change of deletes) {
          if (change.mediaId) {
            batch.add("DELETE FROM media_objects WHERE id = ?", change.mediaId);
          }
        }

        // Reorder media objects
        for (const change of reorders) {
          if (change.mediaId && change.newDisplayOrder !== undefined && change.newDisplayOrder !== null) {
            batch.add(
              "UPDATE media_objects SET display_order = ? WHERE id = ?",
              change.newDisplayOrder,
              change.mediaId
            );
          }
        }

        // Update main image flags
        for (const change of mainImageUpdates) {
          if (change.mediaId && change.isMainImage !== undefined && change.isMainImage !== null) {
            batch.add(
              "UPDATE media_objects SET is_main_picture = ? WHERE id = ?",
              change.isMainImage ? 1 : 0,
              change.mediaId
            );
          }
        }

        // Update album title
        if (albumTitle) {
          batch.add("UPDATE locks SET album_title = ? WHERE id = ?", albumTitle, lockId);
        }
      });

      const mediaToCleanup = cleanupList;

      // 5. Schedule Cloudflare cleanup jobs (after transaction succeeds)
      for (const media of mediaToCleanup) {
        try {
          await this.cleanupJobRepository.create({
            cloudflare_id: media.cloudflare_id,
            media_type: media.media_type,
          });
          this.logger.info("Scheduled Cloudflare cleanup job", { cloudflareId: media.cloudflare_id });
        } catch (cleanupError) {
          this.logger.warn("Failed to schedule Cloudflare cleanup", {
            cloudflareId: media.cloudflare_id,
            error: String(cleanupError),
          });
        }
      }

      this.logger.info("Successfully published album", {
        lockId,
        changeCount: changes.length,
      });

      return success({
        success: true,
        message: `Successfully published ${changes.length} metadata changes`,
        createdMedia: null,
      });
    } catch (error) {
      this.logger.error("Failed to publish album metadata", { lockId, error: String(error) });
      return failure("METADATA_PUBLISH_FAILED", `Failed to publish album: ${String(error)}`, undefined, 500);
    }
  }

  private async processBatchReorder(reorders: MetadataChange[], txDb?: D1Database): Promise<void> {
    const updates = reorders.map((r) => ({
      id: r.mediaId ?? 0,
      displayOrder: r.newDisplayOrder ?? 0,
    }));

    this.logger.info("Sending batch reorder request", { count: updates.length });

    const updatedCount = await this.mediaRepository.batchReorder(updates, txDb);

    if (updatedCount !== updates.length) {
      throw new Error(`Only ${updatedCount} of ${updates.length} updates succeeded`);
    }

    this.logger.info("Successfully batch reordered media objects", { count: updatedCount });
  }


  private async deleteMediaById(mediaId: number, cloudflareId?: string | null, isImage = true): Promise<void> {
    // DB-first deletion pattern: Delete from DB first (in transaction)
    await this.mediaRepository.delete(mediaId);

    // Schedule async Cloudflare cleanup (best-effort with retries)
    if (cloudflareId) {
      try {
        await this.cleanupJobRepository.create({
          cloudflare_id: cloudflareId,
          media_type: isImage ? "image" : "video",
        });
        this.logger.info("Scheduled Cloudflare cleanup job", { cloudflareId, mediaId });
      } catch (error) {
        this.logger.warn("Failed to schedule Cloudflare cleanup", { cloudflareId, mediaId, error: String(error) });
      }
    }
  }

  async getValidationDataEnvelope(lockId: number): Promise<ServiceResult<ValidationData>> {
    try {
      const data = await this.getValidationData(lockId);
      return success(data);
    } catch (error) {
      return failure("VALIDATION_FAILED", String(error), undefined, 404);
    }
  }

  async deleteMedia(mediaId: number): Promise<ServiceResult<boolean>> {
    const media = await this.mediaRepository.findById(mediaId);
    if (!media) {
      return failure("MEDIA_NOT_FOUND", "Media object not found", undefined, 404);
    }

    await this.deleteMediaById(mediaId, media.cloudflare_id, Boolean(media.is_image));
    return success(true, "Media deleted successfully");
  }

  async batchReorder(updates: Array<{ id: number; displayOrder: number }>): Promise<ServiceResult<number>> {
    if (updates.length === 0) {
      return failure("NO_UPDATES", "No updates provided", undefined, 400);
    }

    const updatedCount = await this.mediaRepository.batchReorder(updates);
    if (updatedCount !== updates.length) {
      return failure(
        "PARTIAL_SUCCESS",
        `Only ${updatedCount} of ${updates.length} updates succeeded`,
        { updatedCount },
        500
      );
    }

    return success(updatedCount, `Successfully reordered ${updatedCount} media objects`);
  }

  async getAlbumMedia(lockId: number) {
    const media = await this.mediaRepository.findByLockId(lockId);
    return media.map(mapMediaRowToAlbum);
  }
}
