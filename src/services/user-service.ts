import { Logger } from '../common/logger';
import { failure, ServiceResult, success } from '../common/result';
import { UserRepository } from '../data/repositories/user-repository';
import { LockRepository } from '../data/repositories/lock-repository';
import { MediaObjectRepository } from '../data/repositories/media-object-repository';
import { CleanupJobRepository } from '../data/repositories/cleanup-job-repository';
import { mapUserRowToProfile } from '../data/mappers/user-mapper';
import type { DrizzleClient } from '../data/db';
import { users, locks, mediaObjects } from '../data/schema';
import { eq } from 'drizzle-orm';
import type {
  RemoveIdentifierRequest,
  UpdateDeviceTokenRequest,
  UpdateUserNameRequest,
  UserProfile,
  VerifyIdentifierRequest,
} from './dtos/users';
import type { TwilioVerifyClient } from '../infrastructure/Auth/twilio';

const sanitizePhone = (phone: string) => phone.replace(/\s+/g, '');

export class UserService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly userRepository: UserRepository,
    private readonly lockRepository: LockRepository,
    private readonly mediaRepository: MediaObjectRepository,
    private readonly cleanupJobRepository: CleanupJobRepository,
    private readonly twilioClient: TwilioVerifyClient | null,
    private readonly logger: Logger
  ) {}

  private ensureTwilio(): TwilioVerifyClient {
    if (!this.twilioClient) {
      throw new Error('Twilio Verify is not configured');
    }
    return this.twilioClient;
  }

  async getProfile(userId: number): Promise<ServiceResult<UserProfile>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    return success(mapUserRowToProfile(user));
  }

  async updateName(
    userId: number,
    request: UpdateUserNameRequest
  ): Promise<ServiceResult<UserProfile>> {
    const trimmed = request.name?.trim();
    if (!trimmed) {
      return failure('INVALID_NAME', 'Name is required', undefined, 400);
    }

    if (trimmed.length > 120) {
      return failure('INVALID_NAME', 'Name must be 120 characters or fewer', undefined, 400);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    if (user.name?.trim() !== trimmed) {
      await this.userRepository.updateName(userId, trimmed);
    }

    const updated = await this.userRepository.findById(userId);
    if (!updated) {
      return failure('USER_NOT_FOUND', 'Failed to load updated user', undefined, 500);
    }

    return success(mapUserRowToProfile(updated), 'User name updated successfully');
  }

  async verifyIdentifier(request: VerifyIdentifierRequest): Promise<ServiceResult<boolean>> {
    if (!request.identifier || !request.verifyCode) {
      return failure(
        'INVALID_REQUEST',
        'Identifier and verification code are required',
        undefined,
        400
      );
    }

    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    const twilio = this.ensureTwilio();
    const identifier = request.identifier.trim();
    const verified = await twilio.verifyCode(identifier, request.verifyCode);
    if (!verified) {
      return failure('INVALID_CODE', 'Invalid verification code', undefined, 400);
    }

    try {
      // Check for conflicts first
      if (request.isEmail) {
        const normalized = identifier.toLowerCase();
        const existing = await this.userRepository.findByEmailCaseInsensitive(normalized);
        if (existing && existing.id !== request.userId) {
          return failure('EMAIL_IN_USE', 'Email address is already in use', undefined, 409);
        }

        // Update atomically using batch
        await this.db.batch([
          this.db.update(users).set({ email: normalized }).where(eq(users.id, request.userId)),
          this.db.update(users).set({ email_verified: true }).where(eq(users.id, request.userId)),
        ] as any);
      } else {
        const sanitized = sanitizePhone(identifier);
        const existingByPhone = await this.userRepository.findByPhoneNumber(sanitized);
        const existingByNormalized =
          await this.userRepository.findByNormalizedPhoneNumber(sanitized);
        const existing = existingByPhone ?? existingByNormalized;

        if (existing && existing.id !== request.userId) {
          return failure('PHONE_IN_USE', 'Phone number is already in use', undefined, 409);
        }

        // Update atomically using batch
        await this.db.batch([
          this.db
            .update(users)
            .set({ phone_number: sanitized })
            .where(eq(users.id, request.userId)),
          this.db.update(users).set({ phone_verified: true }).where(eq(users.id, request.userId)),
        ] as any);
      }

      return success(true, 'Identifier verified successfully');
    } catch (error) {
      const errorMsg = String(error);
      if (errorMsg.includes('EMAIL_IN_USE')) {
        return failure('EMAIL_IN_USE', 'Email address is already in use', undefined, 409);
      }
      if (errorMsg.includes('PHONE_IN_USE')) {
        return failure('PHONE_IN_USE', 'Phone number is already in use', undefined, 409);
      }
      this.logger.error('Failed to verify identifier', { userId: request.userId, error: errorMsg });
      return failure('VERIFY_FAILED', 'Failed to verify identifier', undefined, 500);
    }
  }

  async removeIdentifier(request: RemoveIdentifierRequest): Promise<ServiceResult<boolean>> {
    const user = await this.userRepository.findById(request.userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    const hasEmail = !!(user.email && user.email_verified);
    const hasPhone = !!(user.phone_number && user.phone_verified);

    if (request.isEmail) {
      if (!hasPhone) {
        return failure(
          'CANNOT_REMOVE_LAST',
          'Cannot remove the last verified identifier. You must have at least one verified email or phone number.',
          undefined,
          400
        );
      }
      await this.db
        .update(users)
        .set({ email: null, email_verified: false })
        .where(eq(users.id, request.userId));
    } else {
      if (!hasEmail) {
        return failure(
          'CANNOT_REMOVE_LAST',
          'Cannot remove the last verified identifier. You must have at least one verified email or phone number.',
          undefined,
          400
        );
      }
      await this.db
        .update(users)
        .set({ phone_number: null, phone_verified: false })
        .where(eq(users.id, request.userId));
    }

    return success(true, 'Identifier removed successfully');
  }

  async updateDeviceToken(
    userId: number,
    request: UpdateDeviceTokenRequest
  ): Promise<ServiceResult<boolean>> {
    if (!request.deviceToken || request.deviceToken.trim().length === 0) {
      return failure('INVALID_TOKEN', 'Device token is required', undefined, 400);
    }

    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    await this.userRepository.updateDeviceToken(userId, request.deviceToken.trim());
    return success(true, 'Device token updated successfully');
  }

  async deleteAccount(userId: number, deleteMedia: boolean): Promise<ServiceResult<boolean>> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      return failure('USER_NOT_FOUND', 'User not found', undefined, 404);
    }

    try {
      // Wrap all DB operations in transaction
      // Collect all data before starting the batch transaction
      const cleanupList: Array<{ cloudflare_id: string; media_type: 'image' | 'video' }> = [];
      const mediaDeletes: number[] = [];

      if (deleteMedia) {
        // Get all locks for user
        const locks = await this.lockRepository.findAllByUserId(userId);

        // Collect media for Cloudflare cleanup and deletion
        for (const lock of locks) {
          const mediaItems = await this.mediaRepository.findByLockId(lock.id, 100);
          for (const media of mediaItems) {
            if (media.cloudflare_id) {
              cleanupList.push({
                cloudflare_id: media.cloudflare_id,
                media_type: media.is_image ? 'image' : 'video',
              });
            }
            mediaDeletes.push(lock.id); // Track lock IDs for batch deletion
          }
        }
      }

      // Execute all database deletes atomically using batch API
      const batchQueries: any[] = [];

      // Delete all media for each lock
      for (const lockId of [...new Set(mediaDeletes)]) {
        // Use Set to deduplicate lock IDs
        batchQueries.push(this.db.delete(mediaObjects).where(eq(mediaObjects.lock_id, lockId)));
      }

      // Clear lock associations (set user_id to NULL)
      batchQueries.push(
        this.db.update(locks).set({ user_id: null }).where(eq(locks.user_id, userId))
      );

      // Delete the user
      batchQueries.push(this.db.delete(users).where(eq(users.id, userId)));

      if (batchQueries.length > 0) {
        await this.db.batch(batchQueries as [any, ...any[]]);
      }

      const mediaToCleanup = cleanupList;

      // Schedule Cloudflare cleanup jobs (after transaction succeeds)
      for (const media of mediaToCleanup) {
        try {
          await this.cleanupJobRepository.create({
            cloudflare_id: media.cloudflare_id,
            media_type: media.media_type,
          });
          this.logger.info('Scheduled Cloudflare cleanup job for account deletion', {
            cloudflareId: media.cloudflare_id,
          });
        } catch (cleanupError) {
          this.logger.warn('Failed to schedule Cloudflare cleanup', {
            cloudflareId: media.cloudflare_id,
            error: String(cleanupError),
          });
        }
      }

      return success(true, deleteMedia ? 'User and media deleted' : 'User deleted');
    } catch (error) {
      this.logger.error('Failed to delete account', { userId, error: String(error) });
      return failure('DELETE_FAILED', 'Failed to delete account', undefined, 500);
    }
  }

  async resendTwilioCode(isEmail: boolean, identifier: string): Promise<ServiceResult<boolean>> {
    if (!identifier) {
      return failure('INVALID_IDENTIFIER', 'Identifier is required', undefined, 400);
    }

    try {
      const twilio = this.ensureTwilio();
      const sent = isEmail
        ? await twilio.sendEmailVerification(identifier)
        : await twilio.sendSmsVerification(identifier);
      if (!sent) {
        return failure('TWILIO_ERROR', 'Failed to send verification code', undefined, 502);
      }
      return success(true, 'Verification code sent');
    } catch (error) {
      this.logger.error('Resend verification failed', { error: String(error) });
      return failure('TWILIO_ERROR', 'Failed to send verification code', undefined, 502);
    }
  }
}
