import { Logger } from '../common/logger';
import { failure, ServiceResult, success } from '../common/result';
import type { HashIdHelper } from '../common/hashids';
import { LockRepository } from '../data/repositories/lock-repository';
import { MediaObjectRepository } from '../data/repositories/media-object-repository';
import { mapLockRowToSummary } from '../data/mappers/lock-mapper';
import {
  LockSummary,
  PublishMetadataRequest,
  PublishResult,
  UpdateLockNameRequest,
  UploadMediaPayload,
  ValidationData,
} from './dtos/locks';
import { ManageMediaService } from './manage-media-service';

import {} from './dtos/revenuecat';

const formatDateOnly = (date: Date) => date.toISOString().split('T')[0];

/**
 * Core domain service for Lock/Album management.
 * Handles high-level lock operations and delegates media operations to ManageMediaService.
 */
export class LockService {
  constructor(
    private readonly lockRepository: LockRepository,
    private readonly mediaRepository: MediaObjectRepository,
    private readonly mediaService: ManageMediaService,
    private readonly hashids: HashIdHelper,
    private readonly logger: Logger
  ) {}

  async getUserLocks(userId: number): Promise<ServiceResult<LockSummary[]>> {
    const locks = await this.lockRepository.findByUserId(userId);
    const summaries = locks.map((lock) => mapLockRowToSummary(lock, this.hashids));
    return success(summaries, `Retrieved ${summaries.length} locks`);
  }

  /**
   * Links a lock to a user account using a hashed lock ID.
   * Typical flow: User scans a QR code (hashed ID), and this method claims it.
   */
  async connectLockToUser(
    userId: number,
    hashedLockId: string
  ): Promise<ServiceResult<LockSummary>> {
    if (!hashedLockId?.trim()) {
      return failure('INVALID_REQUEST', 'hashedLockId is required', undefined, 400);
    }

    const lockId = this.hashids.decode(hashedLockId);
    if (!lockId) {
      return failure('INVALID_HASH', 'Invalid hashed lock ID', undefined, 400);
    }

    const lock = await this.lockRepository.findById(lockId);
    if (!lock) {
      return failure('LOCK_NOT_FOUND', 'Lock not found', undefined, 404);
    }

    const updated = await this.lockRepository.update(lockId, { user_id: userId });
    return success(mapLockRowToSummary(updated, this.hashids), 'Lock connected successfully');
  }

  async updateLockName(request: UpdateLockNameRequest): Promise<ServiceResult<LockSummary>> {
    if (!request.lockId || !request.newName?.trim()) {
      return failure('INVALID_REQUEST', 'lockId and newName are required', undefined, 400);
    }

    const updated = await this.lockRepository.update(request.lockId, {
      lock_name: request.newName.trim(),
    });

    return success(mapLockRowToSummary(updated, this.hashids), 'Lock name updated successfully');
  }

  async toggleSealDate(lockId: number): Promise<ServiceResult<LockSummary>> {
    const existing = await this.lockRepository.findById(lockId);
    if (!existing) {
      return failure('LOCK_NOT_FOUND', 'Lock not found', undefined, 404);
    }

    const isSealed = Boolean(existing.seal_date);
    const updated = await this.lockRepository.update(lockId, {
      seal_date: isSealed ? null : formatDateOnly(new Date()),
    });

    return success(
      mapLockRowToSummary(updated, this.hashids),
      isSealed ? 'Lock unsealed successfully' : 'Lock sealed successfully'
    );
  }

  async updateGeoLocation(
    lockId: number,
    geoLocation: { lat: number; lng: number }
  ): Promise<ServiceResult<LockSummary>> {
    const existing = await this.lockRepository.findById(lockId);
    if (!existing) {
      return failure('LOCK_NOT_FOUND', 'Lock not found', undefined, 404);
    }

    const geoLocationJson = JSON.stringify(geoLocation);

    const updated = await this.lockRepository.update(lockId, {
      geo_location: geoLocationJson,
    });

    const message = existing.geo_location
      ? 'Geo location updated successfully'
      : 'Geo location set successfully';

    return success(mapLockRowToSummary(updated, this.hashids), message);
  }

  async upgradeStorage(lockId: number): Promise<ServiceResult<LockSummary>> {
    const existing = await this.lockRepository.findById(lockId);
    if (!existing) {
      return failure('LOCK_NOT_FOUND', 'Lock not found', undefined, 404);
    }

    if (existing.upgraded_storage) {
      return success(mapLockRowToSummary(existing, this.hashids), 'Storage already upgraded');
    }

    const updated = await this.lockRepository.update(lockId, { upgraded_storage: true });
    return success(mapLockRowToSummary(updated, this.hashids), 'Storage upgraded successfully');
  }

  async publishMetadata(request: PublishMetadataRequest): Promise<ServiceResult<PublishResult>> {
    return this.mediaService.publishMetadata(request);
  }

  async uploadSingleMedia(payload: UploadMediaPayload) {
    return this.mediaService.uploadSingleMedia(payload);
  }

  async getValidationData(lockId: number): Promise<ServiceResult<ValidationData>> {
    return this.mediaService.getValidationDataEnvelope(lockId);
  }

  async deleteMedia(mediaId: number) {
    return this.mediaService.deleteMedia(mediaId);
  }

  async batchReorder(updates: Array<{ id: number; displayOrder: number }>) {
    return this.mediaService.batchReorder(updates);
  }

  async updateAlbumTitle(lockId: number, albumTitle: string): Promise<ServiceResult<LockSummary>> {
    const updated = await this.lockRepository.update(lockId, { album_title: albumTitle });

    return success(mapLockRowToSummary(updated, this.hashids), 'Album title updated');
  }
}
