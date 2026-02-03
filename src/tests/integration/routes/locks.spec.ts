import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../../index';
import { mockConfig } from '../../mocks';
import { success } from '../../../common/result';

// Define Mock Services and Repositories
const mockLockService = {
    connectLockToUser: vi.fn(),
    toggleSealDate: vi.fn(),
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
        createRequestContext: vi.fn().mockReturnValue({
            env: {},
            var: {
                jwtPayload: { sub: '123' }, // Authenticated User ID 123
            },
            get: (key: string) => {
                if (key === 'container') return mockContainer;
                // Some legacy tests might rely on direct service access if code was not fully using container, 
                // but let's assume getContainer(c) is the standard now.
                // Just in case:
                if (key === 'config') return mockConfig;
                if (key === 'userId') return 123; // Mocking the attached userId from middleware
                return undefined;
            }
        })
    };
});

describe('Lock Routes Integration', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
        vi.clearAllMocks();
        app = buildApp(mockConfig);
    });

    describe('POST /locks/connect/user', () => {
        it('should connect lock successfully', async () => {
            mockLockService.connectLockToUser.mockResolvedValue(success({ id: 1, name: 'My Lock' }));

            const response = await app.request('/locks/connect/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hashedLockId: 'valid-hash' })
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ id: 1, name: 'My Lock' });
        });

        it('should return 400 validation error for empty hash', async () => {
            const response = await app.request('/locks/connect/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hashedLockId: '' })
            });
            expect(response.status).toBe(400);
        });
    });

    describe('PATCH /locks/:lockId/seal', () => {
        it('should seal lock if owned by user', async () => {
            // 1. Mock Repository (ensureLockOwnership)
            mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 123 }); // User matches

            // 2. Mock Service
            mockLockService.toggleSealDate.mockResolvedValue(success({ id: 99, seal_date: '2023-01-01' }));

            // 3. Request
            const response = await app.request('/locks/99/seal', {
                method: 'PATCH',
            });

            expect(response.status).toBe(200);
            expect(mockLockRepository.findById).toHaveBeenCalledWith(99);
            expect(mockLockService.toggleSealDate).toHaveBeenCalledWith(99);
        });

        it('should return 403 if user does not own lock', async () => {
            // 1. Mock Repository
            mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 999 }); // Different User

            // 2. Request
            const response = await app.request('/locks/99/seal', {
                method: 'PATCH',
            });

            expect(response.status).toBe(403);
            expect(mockLockService.toggleSealDate).not.toHaveBeenCalled();
        });

        it('should return 404 if lock not found', async () => {
            // 1. Mock Repository
            mockLockRepository.findById.mockResolvedValue(null);

            // 2. Request
            const response = await app.request('/locks/99/seal', {
                method: 'PATCH',
            });

            expect(response.status).toBe(404);
        });
    });

    describe('POST /locks/publish', () => {
        it('should publish metadata successfully', async () => {
            mockLockRepository.findById.mockResolvedValue({ id: 99, user_id: 123 });
            mockLockService.publishMetadata.mockResolvedValue(success({ success: true }));

            const response = await app.request('/locks/publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': 'some-key'
                },
                body: JSON.stringify({
                    lockId: 99,
                    changes: []
                })
            });

            expect(response.status).toBe(200);
        });
    });
});
