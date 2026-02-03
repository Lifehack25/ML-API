import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { RevenueCatWebhookService } from '../../../../services/revenuecat-webhook-service';
import type { LockRepository } from '../../../../data/repositories/lock-repository';
import type { Logger } from '../../../../common/logger';
import { UNSEAL_PRODUCT_ID, STORAGE_UPGRADE_PRODUCT_ID } from '../../../../services/dtos/revenuecat';

const mockLockRepo = {
    findById: vi.fn(),
    update: vi.fn(),
} as unknown as Mocked<LockRepository>;

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
} as unknown as Mocked<Logger>;

describe('RevenueCatWebhookService', () => {
    let service: RevenueCatWebhookService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new RevenueCatWebhookService(mockLockRepo, mockLogger);
    });

    const createPayload = (type: string, lockId?: string, productId = UNSEAL_PRODUCT_ID, userId = '123'): any => ({
        event: {
            id: 'evt_123',
            type,
            app_user_id: userId,
            product_id: productId,
            environment: 'PRODUCTION',
            subscriber_attributes: lockId ? { lock_id: { value: lockId } } : {},
        }
    });

    it('should ignore non-purchase events', async () => {
        const result = await service.processWebhook(createPayload('CANCELLATION'));
        expect(result.ok).toBe(true);
        expect(result.message).toContain('Event type ignored');
        expect(mockLockRepo.findById).not.toHaveBeenCalled();
    });

    it('should fail if user ID is invalid', async () => {
        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '1', UNSEAL_PRODUCT_ID, 'invalid'));
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('INVALID_USER_ID');
    });

    it('should fail if lock_id is missing', async () => {
        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', undefined));
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('MISSING_LOCK_ID');
    });

    it('should fail if lock not found', async () => {
        mockLockRepo.findById.mockResolvedValue(null);
        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '999'));
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('LOCK_NOT_FOUND');
    });

    it('should fail if lock belongs to different user', async () => {
        mockLockRepo.findById.mockResolvedValue({ id: 999, user_id: 456 } as any);
        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '999', UNSEAL_PRODUCT_ID, '123')); // userId 123
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('FORBIDDEN');
    });

    it('should unseal lock on UNSEAL_PRODUCT_ID purchase', async () => {
        mockLockRepo.findById.mockResolvedValue({ id: 1, user_id: 123, seal_date: '2023-01-01' } as any);

        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '1', UNSEAL_PRODUCT_ID, '123'));

        expect(result.ok).toBe(true);
        expect(mockLockRepo.update).toHaveBeenCalledWith(1, { seal_date: null });
    });

    it('should handle idempotent unseal (already unsealed)', async () => {
        mockLockRepo.findById.mockResolvedValue({ id: 1, user_id: 123, seal_date: null } as any);

        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '1', UNSEAL_PRODUCT_ID, '123'));

        expect(result.ok).toBe(true);
        expect(mockLockRepo.update).not.toHaveBeenCalled();
    });

    it('should upgrade storage on STORAGE_UPGRADE_PRODUCT_ID purchase', async () => {
        mockLockRepo.findById.mockResolvedValue({ id: 1, user_id: 123, upgraded_storage: false } as any);

        const result = await service.processWebhook(createPayload('INITIAL_PURCHASE', '1', STORAGE_UPGRADE_PRODUCT_ID, '123'));

        expect(result.ok).toBe(true);
        expect(mockLockRepo.update).toHaveBeenCalledWith(1, { upgraded_storage: true });
    });
});
