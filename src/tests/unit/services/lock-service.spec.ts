import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { LockService } from '../../../services/lock-service';
import type { LockRepository } from '../../../data/repositories/lock-repository';
import type { MediaObjectRepository } from '../../../data/repositories/media-object-repository';
import type { ManageMediaService } from '../../../services/manage-media-service';
import type { HashIdHelper } from '../../../common/hashids';
import type { Logger } from '../../../common/logger';

const mockLockRepo = {
  findByUserId: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
} as unknown as Mocked<LockRepository>;

const mockMediaRepo = {} as unknown as Mocked<MediaObjectRepository>;

const mockMediaService = {
  publishMetadata: vi.fn(),
  uploadSingleMedia: vi.fn(),
  getValidationDataEnvelope: vi.fn(),
  deleteMedia: vi.fn(),
  batchReorder: vi.fn(),
} as unknown as Mocked<ManageMediaService>;

const mockHashids = {
  decode: vi.fn(),
  encode: vi.fn(),
} as unknown as Mocked<HashIdHelper>;

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as Mocked<Logger>;

describe('LockService', () => {
  let service: LockService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LockService(
      mockLockRepo,
      mockMediaRepo,
      mockMediaService,
      mockHashids,
      mockLogger
    );
  });

  describe('connectLockToUser', () => {
    it('should fail if hashedLockId is missing', async () => {
      const result = await service.connectLockToUser(1, '');
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_REQUEST');
    });

    it('should fail if hashedLockId decodes to nothing (invalid hash)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockHashids.decode.mockReturnValue(null as any);
      const result = await service.connectLockToUser(1, 'invalid-hash');
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_HASH');
    });

    it('should fail if lock does not exist', async () => {
      mockHashids.decode.mockReturnValue(123);
      mockLockRepo.findById.mockResolvedValue(null);

      const result = await service.connectLockToUser(1, 'valid-hash');
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('LOCK_NOT_FOUND');
    });

    it('should fail if lock is already connected to the same user', async () => {
      mockHashids.decode.mockReturnValue(123);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 123, user_id: 1 } as any);

      const result = await service.connectLockToUser(1, 'valid-hash');
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(result.error.code).toBe('LOCK_ALREADY_CONNECTED');
      expect(result.error.message).toBe('This lock is already connected to your account.');
      expect(mockLockRepo.update).not.toHaveBeenCalled();
    });

    it('should fail if lock is already connected to another user', async () => {
      mockHashids.decode.mockReturnValue(123);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 123, user_id: 2 } as any);

      const result = await service.connectLockToUser(1, 'valid-hash');
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(result.error.code).toBe('LOCK_ALREADY_CONNECTED');
      expect(result.error.message).toBe('This lock is already connected to another user.');
      expect(mockLockRepo.update).not.toHaveBeenCalled();
    });

    it('should successfully update user_id on lock', async () => {
      mockHashids.decode.mockReturnValue(123);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 123 } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.update.mockResolvedValue({ id: 123, user_id: 1 } as any);
      mockHashids.encode.mockReturnValue('valid-hash');

      const result = await service.connectLockToUser(1, 'valid-hash');

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(mockLockRepo.update).toHaveBeenCalledWith(123, { user_id: 1 });
    });
  });

  describe('toggleSealDate', () => {
    it('should fail if lock not found', async () => {
      mockLockRepo.findById.mockResolvedValue(null);
      const result = await service.toggleSealDate(1);
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('LOCK_NOT_FOUND');
    });

    it('should set seal_date if currently null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 1, seal_date: null } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.update.mockResolvedValue({ id: 1, seal_date: '2023-01-01' } as any);

      const result = await service.toggleSealDate(1);

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Lock sealed successfully');
      expect(mockLockRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          seal_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // Expects YYYY-MM-DD
        })
      );
    });

    it('should clear seal_date if currently set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 1, seal_date: '2023-01-01' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.update.mockResolvedValue({ id: 1, seal_date: null } as any);

      const result = await service.toggleSealDate(1);

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Lock unsealed successfully');
      expect(mockLockRepo.update).toHaveBeenCalledWith(1, { seal_date: null });
    });
  });

  describe('unsealLock', () => {
    it('should fail if lock not found', async () => {
      mockLockRepo.findById.mockResolvedValue(null);
      const result = await service.unsealLock(1);
      if (result.ok) throw new Error('Expected failure');
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('LOCK_NOT_FOUND');
    });

    it('should be idempotent when lock is already unsealed', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 1, seal_date: null } as any);

      const result = await service.unsealLock(1);

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Lock already unsealed');
      expect(mockLockRepo.update).not.toHaveBeenCalled();
    });

    it('should clear seal_date when lock is sealed', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 1, seal_date: '2023-01-01' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.update.mockResolvedValue({ id: 1, seal_date: null } as any);

      const result = await service.unsealLock(1);

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('Lock unsealed successfully');
      expect(mockLockRepo.update).toHaveBeenCalledWith(1, { seal_date: null });
    });
  });

  describe('updateGeoLocation', () => {
    it('should update geo location', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.findById.mockResolvedValue({ id: 1 } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockLockRepo.update.mockResolvedValue({ id: 1, geo_location: '{"lat":10,"lng":20}' } as any);

      const result = await service.updateGeoLocation(1, { lat: 10, lng: 20 });

      if (!result.ok) throw new Error('Expected success');
      expect(result.ok).toBe(true);
      expect(mockLockRepo.update).toHaveBeenCalledWith(1, {
        geo_location: JSON.stringify({ lat: 10, lng: 20 }),
      });
    });
  });
});
