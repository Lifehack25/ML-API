import { JwtService } from "../../infrastructure/Auth/jwt";
import { UserRepository } from "../../data/repositories/user-repository";
import { Logger } from "../../common/logger";
import { JwtTokens } from "../dtos/users";

interface IssueTokenOptions {
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  context?: string;
}

export class UserSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly logger: Logger
  ) {}

  async issueTokens(userId: number, options: IssueTokenOptions = {}): Promise<JwtTokens> {
    try {
      await this.userRepository.updateAuthMetadata(userId, {
        emailVerified: options.emailVerified ?? undefined,
        phoneVerified: options.phoneVerified ?? undefined,
        lastLoginAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn("Failed to update auth metadata", { userId, error: String(error) });
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.generateAccessToken(userId),
      this.jwtService.generateRefreshToken(userId),
    ]);

    this.logger.info("Issued JWT tokens", { userId, context: options.context });

    return {
      accessToken,
      refreshToken,
      userId,
    };
  }
}

