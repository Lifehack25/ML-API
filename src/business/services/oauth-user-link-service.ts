import { UserRepository } from "../../data/repositories/user-repository";
import { Logger } from "../../common/logger";
import { CreateUserRequest } from "../dtos/users";
import { withTransaction } from "../../data/transaction";

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
    return withTransaction(this.db, async (tx) => {
      // Step 1: try provider mapping (within transaction)
      const existingProvider = await this.userRepository.findByProvider(info.provider, info.providerId, tx);
      if (existingProvider) {
        this.logger.info("Found user by provider", { provider: info.provider, userId: existingProvider.id });
        return existingProvider.id;
      }

      // Step 2: fallback to email lookup (within transaction)
      if (info.email) {
        const existingByEmail = await this.userRepository.findByEmailCaseInsensitive(info.email, tx);
        if (existingByEmail) {
          // Link provider and mark verified atomically
          await this.userRepository.linkProvider(existingByEmail.id, info.provider, info.providerId, tx);
          if (info.emailVerified) {
            await this.userRepository.markEmailVerified(existingByEmail.id, tx);
          }
          this.logger.info("Linked provider to existing email", { provider: info.provider, userId: existingByEmail.id });
          return existingByEmail.id;
        }
      }

      // Step 3: create new user (within transaction)
      const createRequest: CreateUserRequest = {
        name: info.name && info.name.trim().length > 0 ? info.name.trim() : `${capitalize(info.provider)} User`,
        email: info.email ?? null,
        phoneNumber: null,
        authProvider: info.provider,
        providerId: info.providerId,
      };

      const created = await this.userRepository.create(createRequest, tx);

      // Mark email verified and link provider atomically
      if (info.emailVerified && createRequest.email) {
        await this.userRepository.markEmailVerified(created.id, tx);
      }

      if (createRequest.authProvider && createRequest.providerId) {
        await this.userRepository.linkProvider(created.id, createRequest.authProvider, createRequest.providerId, tx);
      }

      this.logger.info("Created new external user", { provider: info.provider, userId: created.id });
      return created.id;
    });
  }
}

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
