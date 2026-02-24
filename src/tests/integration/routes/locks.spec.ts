import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../../index';
import { mockConfig } from '../../mocks';
import { success } from '../../../common/result';
import { sign } from 'hono/jwt';
import { createLogger } from '../../../common/logger';

// Mock cache invalidation to prevent "caches is not defined" error in Node env
vi.mock('../../../infrastructure/cache-invalidation', () => ({
  invalidateAlbumCache: vi.fn(),
}));

// Define Mock Services and Repositories
const mockLockService = {
  connectLockToUser: vi.fn(),
  toggleSealDate: vi.fn(),
  unsealLock: vi.fn(),
  publishMetadata: vi.fn(),
  uploadSingleMedia: vi.fn(),
  getValidationData: vi.fn(),
};

const mockLockRepository = {
  findById: vi.fn(),
};

const mockHashIds = {
  encode: vi.fn(),
  decode: vi.fn(),
};

const mockIdempotencyService = {
  checkIdempotency: vi.fn().mockResolvedValue(null),
  storeResult: vi.fn().mockResolvedValue(undefined),
};

const mockContainer = {
  // Add logger to prevent potential crashes if middleware assumes it exists (though middleware checks)
  // and for general completeness.
  logger: createLogger('test-req-id'),
  services: {
    locks: mockLockService,
  },
  repositories: {
    locks: mockLockRepository,
  },
  idempotencyService: mockIdempotencyService,
  hashids: mockHashIds,
};

// Mock the container/services
vi.mock('../../../common/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../common/context')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRequestContext: vi.fn().mockImplementation(() => mockContainer as any),
  };
});

describe('Lock Routes Integration', () => {
  let app: ReturnType<typeof buildApp>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp(mockConfig);
    token = await sign({ sub: '123', userId: 123 }, mockConfig.jwt.secret);
  });

  describe('POST /locks/connect/user', () => {
    it('should connect lock successfully', async () => {
      mockLockService.connectLockToUser.mockResolvedValue(success({ id: 1, name: 'My Lock' }));

      const response = await app.request(
        '/locks/connect/user',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ hashedLockId: 'valid-hash' }),
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 1, name: 'My Lock' });
    });

    it('should return 400 validation error for empty hash', async () => {
      const response = await app.request(
        '/locks/connect/user',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ hashedLockId: '' }),
        },
        {},
        executionCtx
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /locks/:lockId/seal', () => {
    it('should seal lock if owned by user', async () => {
      // 1. Mock Repository (ensureLockOwnership)
      mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 123 }); // User matches

      // 2. Mock Service
      mockLockService.toggleSealDate.mockResolvedValue(
        success({ id: 99, seal_date: '2023-01-01' })
      );

      // 3. Request
      const response = await app.request(
        '/locks/99/seal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(200);
      expect(mockLockRepository.findById).toHaveBeenCalledWith(99);
      expect(mockLockService.toggleSealDate).toHaveBeenCalledWith(99);
    });

    it('should return 403 if user does not own lock', async () => {
      // 1. Mock Repository
      mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 999 }); // Different User

      // 2. Request
      const response = await app.request(
        '/locks/99/seal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(403);
      expect(mockLockService.toggleSealDate).not.toHaveBeenCalled();
    });

    it('should return 404 if lock not found', async () => {
      // 1. Mock Repository
      mockLockRepository.findById.mockResolvedValue(null);

      // 2. Request
      const response = await app.request(
        '/locks/99/seal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /locks/:lockId/unseal', () => {
    it('should unseal lock if owned by user', async () => {
      mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 123 });
      mockLockService.unsealLock.mockResolvedValue(success({ id: 99, seal_date: null }));

      const response = await app.request(
        '/locks/99/unseal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(200);
      expect(mockLockRepository.findById).toHaveBeenCalledWith(99);
      expect(mockLockService.unsealLock).toHaveBeenCalledWith(99);
    });

    it('should return 403 if user does not own lock', async () => {
      mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 999 });

      const response = await app.request(
        '/locks/99/unseal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(403);
      expect(mockLockService.unsealLock).not.toHaveBeenCalled();
    });

    it('should return 404 if lock not found', async () => {
      mockLockRepository.findById.mockResolvedValue(null);

      const response = await app.request(
        '/locks/99/unseal',
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /locks/publish', () => {
    it('should publish metadata successfully', async () => {
      mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 123 });
      mockLockService.publishMetadata.mockResolvedValue(success({ success: true }));

      const response = await app.request(
        '/locks/publish',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'some-key',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            lockId: 99,
            changes: [],
          }),
        },
        {},
        executionCtx
      );

      expect(response.status).toBe(200);
    });
  });
});
