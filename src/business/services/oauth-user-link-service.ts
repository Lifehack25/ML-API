import { UserRepository } from "../../data/repositories/user-repository";
import { Logger } from "../../common/logger";
import { CreateUserRequest } from "../dtos/users";
import { withBatch } from "../../data/transaction";

export interface OAuthUserInfo {
  provider: string;
  providerId: string;
  email?: string | null;
  name?: string | null;
  emailVerified?: boolean;
}

export class OAuthUserLinkService {
  constructor(
    private readonly db: D1Database,
    private readonly userRepository: UserRepository,
    private readonly logger: Logger
  ) {}

  async findOrCreate(info: OAuthUserInfo): Promise<number> {
    // Step 1: try provider mapping
    const existingProvider = await this.userRepository.findByProvider(info.provider, info.providerId);
    if (existingProvider) {
      this.logger.info("Found user by provider", { provider: info.provider, userId: existingProvider.id });
      return existingProvider.id;
    }

    // Step 2: fallback to email lookup
    if (info.email) {
      const existingByEmail = await this.userRepository.findByEmailCaseInsensitive(info.email);
      if (existingByEmail) {
        // Link provider and mark verified atomically using batch API
        await withBatch(this.db, (batch) => {
          batch.add(
            "UPDATE users SET auth_provider = ?, provider_id = ? WHERE id = ?",
            info.provider,
            info.providerId,
            existingByEmail.id
          );

          if (info.emailVerified) {
            batch.add("UPDATE users SET email_verified = 1 WHERE id = ?", existingByEmail.id);
          }
        });

        this.logger.info("Linked provider to existing email", { provider: info.provider, userId: existingByEmail.id });
        return existingByEmail.id;
      }
    }

    // Step 3: create new user with compensating transaction pattern
    const createRequest: CreateUserRequest = {
      name: info.name && info.name.trim().length > 0 ? info.name.trim() : `${capitalize(info.provider)} User`,
      email: info.email ?? null,
      phoneNumber: null,
      authProvider: info.provider,
      providerId: info.providerId,
    };

    const created = await this.userRepository.create(createRequest);

    try {
      // Update user atomically: mark email verified and link provider
      // Use batch API to ensure both updates succeed together
      await withBatch(this.db, (batch) => {
        if (info.emailVerified && createRequest.email) {
          batch.add("UPDATE users SET email_verified = 1 WHERE id = ?", created.id);
        }

        if (createRequest.authProvider && createRequest.providerId) {
          batch.add(
            "UPDATE users SET auth_provider = ?, provider_id = ? WHERE id = ?",
            createRequest.authProvider,
            createRequest.providerId,
            created.id
          );
        }
      });

      this.logger.info("Created new external user", { provider: info.provider, userId: created.id });
      return created.id;
    } catch (error) {
      // Compensating transaction: delete the user if we failed to link provider
      this.logger.error("Failed to link provider, rolling back user creation", { userId: created.id, error });
      try {
        await this.userRepository.delete(created.id);
      } catch (deleteError) {
        this.logger.error("CRITICAL: Failed to delete user during rollback", { userId: created.id, deleteError });
      }
      throw error;
    }
  }
}

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
