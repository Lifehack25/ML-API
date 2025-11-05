import { Logger } from "../../common/logger";
import { failure, ServiceResult, success } from "../../common/result";
import { UserRepository } from "../../data/repositories/user-repository";
import { LockRepository } from "../../data/repositories/lock-repository";
import { MediaObjectRepository } from "../../data/repositories/media-object-repository";
import { CleanupJobRepository } from "../../data/repositories/cleanup-job-repository";
import { mapUserRowToProfile } from "../../data/mappers/user-mapper";
import { withTransaction } from "../../data/transaction";
import {
  UpdateDeviceTokenRequest,
  UpdateUserNameRequest,
  UserProfile,
  VerifyIdentifierRequest,
} from "../dtos/users";
import { TwilioVerifyClient } from "../../infrastructure/Auth/twilio";

const sanitizePhone = (phone: string) => phone.replace(/\s+/g, "");

export class UserService {
  constructor(
    private readonly db: D1Database,
    private readonly userRepository: UserRepository,
    private readonly lockRepository: LockRepository,
    private readonly mediaRepository: MediaObjectRepository,
    private readonly cleanupJobRepository: CleanupJobRepository,
    private readonly twilioClient: TwilioVerifyClient | null,
    private readonly logger: Logger
  ) {}

  private ensureTwilio(): TwilioVerifyClient {
    if (!this.twilioClient) {
      throw new Error("Twilio Verify is not configured");
    }
    return this.twilioClient;
  }

  async getProfile(userId: number): Promise<ServiceResult<UserProfile>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure("USER_NOT_FOUND", "User not found", undefined, 404);
    }

    return success(mapUserRowToProfile(user));
  }

  async updateName(userId: number, request: UpdateUserNameRequest): Promise<ServiceResult<UserProfile>> {
    const trimmed = request.name?.trim();
    if (!trimmed) {
      return failure("INVALID_NAME", "Name is required", undefined, 400);
    }

    if (trimmed.length > 120) {
      return failure("INVALID_NAME", "Name must be 120 characters or fewer", undefined, 400);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure("USER_NOT_FOUND", "User not found", undefined, 404);
    }

    if (user.name?.trim() !== trimmed) {
      await this.userRepository.updateName(userId, trimmed);
    }

    const updated = await this.userRepository.findById(userId);
    if (!updated) {
      return failure("USER_NOT_FOUND", "Failed to load updated user", undefined, 500);
    }

    return success(mapUserRowToProfile(updated), "User name updated successfully");
  }

  async verifyIdentifier(request: VerifyIdentifierRequest): Promise<ServiceResult<boolean>> {
    if (!request.identifier || !request.verifyCode) {
      return failure("INVALID_REQUEST", "Identifier and verification code are required", undefined, 400);
    }

    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      return failure("USER_NOT_FOUND", "User not found", undefined, 404);
    }

    const twilio = this.ensureTwilio();
    const identifier = request.identifier.trim();
    const verified = await twilio.verifyCode(identifier, request.verifyCode);
    if (!verified) {
      return failure("INVALID_CODE", "Invalid verification code", undefined, 400);
    }

    try {
      // Wrap DB operations in transaction
      await withTransaction(this.db, async (tx) => {
        if (request.isEmail) {
          const normalized = identifier.toLowerCase();
          const existing = await this.userRepository.findByEmailCaseInsensitive(normalized, tx);
          if (existing && existing.id !== request.userId) {
            throw new Error("EMAIL_IN_USE: Email address is already in use");
          }

          await this.userRepository.updateEmail(request.userId, normalized, tx);
          await this.userRepository.markEmailVerified(request.userId, tx);
        } else {
          const sanitized = sanitizePhone(identifier);
          const existingByPhone = await this.userRepository.findByPhoneNumber(sanitized, tx);
          const existingByNormalized = await this.userRepository.findByNormalizedPhoneNumber(sanitized, tx);
          const existing = existingByPhone ?? existingByNormalized;

          if (existing && existing.id !== request.userId) {
            throw new Error("PHONE_IN_USE: Phone number is already in use");
          }

          await this.userRepository.updatePhoneNumber(request.userId, sanitized, tx);
          await this.userRepository.markPhoneVerified(request.userId, tx);
        }
      });

      return success(true, "Identifier verified successfully");
    } catch (error) {
      const errorMsg = String(error);
      if (errorMsg.includes("EMAIL_IN_USE")) {
        return failure("EMAIL_IN_USE", "Email address is already in use", undefined, 409);
      }
      if (errorMsg.includes("PHONE_IN_USE")) {
        return failure("PHONE_IN_USE", "Phone number is already in use", undefined, 409);
      }
      this.logger.error("Failed to verify identifier", { userId: request.userId, error: errorMsg });
      return failure("VERIFY_FAILED", "Failed to verify identifier", undefined, 500);
    }
  }

  async updateDeviceToken(userId: number, request: UpdateDeviceTokenRequest): Promise<ServiceResult<boolean>> {
    if (!request.deviceToken || request.deviceToken.trim().length === 0) {
      return failure("INVALID_TOKEN", "Device token is required", undefined, 400);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure("USER_NOT_FOUND", "User not found", undefined, 404);
    }

    await this.userRepository.updateDeviceToken(userId, request.deviceToken.trim());
    return success(true, "Device token updated successfully");
  }

  async deleteAccount(userId: number, deleteMedia: boolean): Promise<ServiceResult<boolean>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure("USER_NOT_FOUND", "User not found", undefined, 404);
    }

    try {
      // Wrap all DB operations in transaction
      const mediaToCleanup = await withTransaction(this.db, async (tx) => {
        const cleanupList: Array<{ cloudflare_id: string; media_type: "image" | "video" }> = [];

        if (deleteMedia) {
          // Get all locks for user
          const locks = await this.lockRepository.findAllByUserId(userId, tx);

          // Collect media for Cloudflare cleanup
          for (const lock of locks) {
            const mediaItems = await this.mediaRepository.findByLockId(lock.id, 100, tx);
            for (const media of mediaItems) {
              if (media.cloudflare_id) {
                cleanupList.push({
                  cloudflare_id: media.cloudflare_id,
                  media_type: media.is_image ? "image" : "video",
                });
              }
            }

            // Delete media from DB (within transaction)
            await this.mediaRepository.deleteByLockId(lock.id, tx);
          }
        }

        // Clear lock associations and delete user (within transaction)
        await this.lockRepository.clearUserAssociation(userId, tx);
        await this.userRepository.delete(userId, tx);

        // Transaction commits - all or nothing
        return cleanupList;
      });

      // Schedule Cloudflare cleanup jobs (after transaction succeeds)
      for (const media of mediaToCleanup) {
        try {
          await this.cleanupJobRepository.create({
            cloudflare_id: media.cloudflare_id,
            media_type: media.media_type,
          });
          this.logger.info("Scheduled Cloudflare cleanup job for account deletion", {
            cloudflareId: media.cloudflare_id,
          });
        } catch (cleanupError) {
          this.logger.warn("Failed to schedule Cloudflare cleanup", {
            cloudflareId: media.cloudflare_id,
            error: String(cleanupError),
          });
        }
      }

      return success(true, deleteMedia ? "User and media deleted" : "User deleted");
    } catch (error) {
      this.logger.error("Failed to delete account", { userId, error: String(error) });
      return failure("DELETE_FAILED", "Failed to delete account", undefined, 500);
    }
  }

  async resendTwilioCode(isEmail: boolean, identifier: string): Promise<ServiceResult<boolean>> {
    if (!identifier) {
      return failure("INVALID_IDENTIFIER", "Identifier is required", undefined, 400);
    }

    try {
      const twilio = this.ensureTwilio();
      const sent = isEmail
        ? await twilio.sendEmailVerification(identifier)
        : await twilio.sendSmsVerification(identifier);
      if (!sent) {
        return failure("TWILIO_ERROR", "Failed to send verification code", undefined, 502);
      }
      return success(true, "Verification code sent");
    } catch (error) {
      this.logger.error("Resend verification failed", { error: String(error) });
      return failure("TWILIO_ERROR", "Failed to send verification code", undefined, 502);
    }
  }
}

