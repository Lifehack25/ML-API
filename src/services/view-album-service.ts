import { Logger } from '../common/logger';
import { failure, ServiceResult, success } from '../common/result';
import { LockRepository } from '../data/repositories/lock-repository';
import { MediaObjectRepository } from '../data/repositories/media-object-repository';
import { mapMediaRowToAlbum } from '../data/mappers/media-mapper';
import { HashIdHelper } from '../common/hashids';
import { LockService } from './lock-service';
import { AlbumResponse } from './dtos/albums';

export class ViewAlbumService {
  constructor(
    private readonly lockRepository: LockRepository,
    private readonly mediaRepository: MediaObjectRepository,
    private readonly lockService: LockService,
    private readonly hashids: HashIdHelper,
    private readonly logger: Logger
  ) {}

  /**
   * Get album data for display.
   * This method only fetches data and does NOT increment scan counts.
   * Scan counting is handled separately by ScanCounterService for caching purposes.
   *
   * @param hashedId - Hashed lock identifier
   * @returns Album response with lock and media data
   */
  async getAlbumData(hashedId: string): Promise<ServiceResult<AlbumResponse>> {
    if (!hashedId) {
      return failure('INVALID_IDENTIFIER', 'Lock identifier is required', undefined, 400);
    }

    if (!this.hashids.isHash(hashedId)) {
      return failure('INVALID_IDENTIFIER', 'Invalid lock identifier format', undefined, 400);
    }

    const lockId = this.hashids.decode(hashedId);
    if (!lockId) {
      return failure('INVALID_IDENTIFIER', 'Invalid lock identifier', undefined, 400);
    }

    const lock = await this.lockRepository.findById(lockId);
    if (!lock) {
      return failure('LOCK_NOT_FOUND', 'Album not found', undefined, 404);
    }

    const media = await this.mediaRepository.findByLockId(lockId);
    media.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    const dto: AlbumResponse = {
      AlbumTitle: lock.album_title ?? 'Untitled Album',
      SealDate: lock.seal_date ?? null,
      Media: media.map(mapMediaRowToAlbum),
    };

    return success(dto);
  }

  /**
   * Helper method to decode hashed ID to numeric lock ID
   */
  decodeLockId(hashedId: string): number | null {
    if (!this.hashids.isHash(hashedId)) {
      return null;
    }
    return this.hashids.decode(hashedId);
  }
}
