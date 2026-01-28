import { Logger } from "../../common/logger";
import { failure, ServiceResult, success } from "../../common/result";
import { LockRepository } from "../../data/repositories/lock-repository";
import type {
  RevenueCatWebhookPayload,
  RevenueCatEventType,
} from "../dtos/revenuecat";
import { UNSEAL_PRODUCT_ID, STORAGE_UPGRADE_PRODUCT_ID } from "../dtos/revenuecat";

export class RevenueCatWebhookService {
  constructor(
    private readonly lockRepository: LockRepository,
    private readonly logger: Logger
  ) {}

  async processWebhook(payload: RevenueCatWebhookPayload): Promise<ServiceResult<void>> {
    try {
      const event = payload.event;

      this.logger.info("Processing RevenueCat webhook", {
        eventType: event.type,
        eventId: event.id,
        appUserId: event.app_user_id,
        productId: event.product_id,
        environment: event.environment,
      });

      // Only process purchase events
      const purchaseEvents: RevenueCatEventType[] = ["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE"];
      if (!purchaseEvents.includes(event.type)) {
        this.logger.info("Ignoring non-purchase event", { eventType: event.type });
        return success(undefined, "Event type ignored");
      }

      // Only process production events (ignore sandbox in production)
      if (event.environment !== "PRODUCTION") {
        this.logger.info("Ignoring sandbox event", { eventId: event.id });
        return success(undefined, "Sandbox event ignored");
      }

      // Extract user ID (stored as string in RevenueCat)
      const userId = parseInt(event.app_user_id, 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        this.logger.error("Invalid user ID in webhook", { appUserId: event.app_user_id });
        return failure("INVALID_USER_ID", "Invalid user ID in webhook payload", undefined, 400);
      }

      // Extract lock_id from subscriber attributes
      const lockIdAttr = event.subscriber_attributes?.["lock_id"];
      if (!lockIdAttr?.value) {
        this.logger.error("Missing lock_id in subscriber attributes", {
          eventId: event.id,
          attributes: event.subscriber_attributes,
        });
        return failure("MISSING_LOCK_ID", "lock_id attribute missing from purchase", undefined, 400);
      }

      const lockId = parseInt(lockIdAttr.value, 10);
      if (!Number.isFinite(lockId) || lockId <= 0) {
        this.logger.error("Invalid lock_id in subscriber attributes", { lockIdValue: lockIdAttr.value });
        return failure("INVALID_LOCK_ID", "Invalid lock_id in subscriber attributes", undefined, 400);
      }

      // Validate lock exists and belongs to user
      const lock = await this.lockRepository.findById(lockId);
      if (!lock) {
        this.logger.error("Lock not found", { lockId });
        return failure("LOCK_NOT_FOUND", `Lock ${lockId} not found`, undefined, 404);
      }

      if (lock.user_id !== userId) {
        this.logger.error("Lock ownership mismatch", {
          lockId,
          expectedUserId: lock.user_id,
          providedUserId: userId,
        });
        return failure("FORBIDDEN", "Lock does not belong to user", undefined, 403);
      }

      // Process based on product ID
      if (event.product_id === UNSEAL_PRODUCT_ID) {
        return await this.handleUnsealPurchase(lockId, event.id);
      } else if (event.product_id === STORAGE_UPGRADE_PRODUCT_ID) {
        return await this.handleStorageUpgradePurchase(lockId, event.id);
      } else {
        this.logger.warn("Unknown product ID in webhook", { productId: event.product_id });
        return success(undefined, "Unknown product ID - no action taken");
      }
    } catch (error) {
      this.logger.error("Unexpected error processing webhook", { error: String(error) });
      return failure("WEBHOOK_PROCESSING_ERROR", "Failed to process webhook", undefined, 500);
    }
  }

  private async handleUnsealPurchase(lockId: number, eventId: string): Promise<ServiceResult<void>> {
    try {
      this.logger.info("Processing unseal purchase", { lockId, eventId });

      // Check if already unsealed
      const lock = await this.lockRepository.findById(lockId);
      if (!lock?.seal_date) {
        this.logger.info("Lock already unsealed - idempotent success", { lockId });
        return success(undefined, "Lock already unsealed");
      }

      // Unseal the lock (set seal_date to null)
      await this.lockRepository.update(lockId, { seal_date: null });

      this.logger.info("Lock unsealed successfully", { lockId, eventId });
      return success(undefined, "Lock unsealed successfully");
    } catch (error) {
      this.logger.error("Failed to unseal lock", { lockId, eventId, error: String(error) });
      return failure("UNSEAL_FAILED", "Failed to unseal lock", undefined, 500);
    }
  }

  private async handleStorageUpgradePurchase(lockId: number, eventId: string): Promise<ServiceResult<void>> {
    try {
      this.logger.info("Processing storage upgrade purchase", { lockId, eventId });

      // Check if already upgraded
      const lock = await this.lockRepository.findById(lockId);
      if (lock?.upgraded_storage) {
        this.logger.info("Storage already upgraded - idempotent success", { lockId });
        return success(undefined, "Storage already upgraded");
      }

      // Upgrade storage (set upgraded_storage to true)
      await this.lockRepository.update(lockId, { upgraded_storage: true });

      this.logger.info("Storage upgraded successfully", { lockId, eventId });
      return success(undefined, "Storage upgraded successfully");
    } catch (error) {
      this.logger.error("Failed to upgrade storage", { lockId, eventId, error: String(error) });
      return failure("STORAGE_UPGRADE_FAILED", "Failed to upgrade storage", undefined, 500);
    }
  }
}
