import { Logger } from "../../common/logger";
import { failure, ServiceResult, success } from "../../common/result";
import { UserRepository } from "../../data/repositories/user-repository";
import { TwilioVerifyClient } from "../../infrastructure/Auth/twilio";
import { JwtService } from "../../infrastructure/Auth/jwt";
import { AppleVerifier } from "../../infrastructure/Auth/oauth-apple";
import { GoogleVerifier } from "../../infrastructure/Auth/oauth-google";
import { withTransaction } from "../../data/transaction";
import {
  AppleAuthRequest,
  GoogleAuthRequest,
  JwtTokens,
  RefreshTokenRequest,
  SendCodeRequest,
  VerifyCodeRequest,
} from "../dtos/users";
import { SessionTokenService } from "./session-token-service";
import { OAuthUserInfo, OAuthUserLinkService } from "./oauth-user-link-service";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const sanitizePhone = (phone: string) => phone.replace(/\s+/g, "");

export class UserAuthFlowService {
  constructor(
    private readonly db: D1Database,
    private readonly userRepository: UserRepository,
    private readonly twilioClient: TwilioVerifyClient | null,
    private readonly jwtService: JwtService,
    private readonly sessionTokenService: SessionTokenService,
    private readonly oauthUserLinkService: OAuthUserLinkService,
    private readonly appleVerifier: AppleVerifier,
    private readonly googleVerifier: GoogleVerifier,
    private readonly logger: Logger
  ) {}

  private ensureTwilio(): TwilioVerifyClient {
    if (!this.twilioClient) {
      throw new Error("Twilio Verify is not configured");
    }
    return this.twilioClient;
  }

  async sendVerificationCode(request: SendCodeRequest): Promise<ServiceResult<{ userExists: boolean }>> {
    if (!request.identifier || request.identifier.trim().length === 0) {
      return failure("INVALID_IDENTIFIER", "Identifier is required", undefined, 400);
    }

    const identifier = request.identifier.trim();
    let userExists = false;

    if (request.isEmail) {
      userExists = Boolean(await this.userRepository.findByEmailCaseInsensitive(identifier));
    } else {
      userExists = Boolean(
        (await this.userRepository.findByPhoneNumber(identifier)) ??
          (await this.userRepository.findByNormalizedPhoneNumber(identifier))
      );
    }

    const shouldSendCode = (request.isLogin && userExists) || (!request.isLogin && !userExists);
    if (!shouldSendCode) {
      // Return success but do not send code to maintain original flow semantics.
      return success({ userExists }, request.isLogin ? "User not found" : "User already exists");
    }

    try {
      const twilio = this.ensureTwilio();
      const result = request.isEmail
        ? await twilio.sendEmailVerification(identifier)
        : await twilio.sendSmsVerification(identifier);

      if (!result) {
        return failure("TWILIO_ERROR", "Failed to send verification code", undefined, 502);
      }

      return success({ userExists }, "Verification code sent");
    } catch (error) {
      this.logger.error("Twilio send verification failed", { error: String(error) });
      return failure("TWILIO_ERROR", "Failed to send verification code", undefined, 502);
    }
  }

  async verifyCode(request: VerifyCodeRequest): Promise<ServiceResult<JwtTokens>> {
    if (!request.identifier || !request.verifyCode) {
      return failure("INVALID_REQUEST", "Identifier and verification code are required", undefined, 400);
    }

    const identifier = request.identifier.trim();
    const twilio = this.ensureTwilio();

    const verified = await twilio.verifyCode(identifier, request.verifyCode);
    if (!verified) {
      return failure("INVALID_CODE", "Invalid verification code", undefined, 400);
    }

    const isLogin = !request.name;

    try {
      if (isLogin) {
        const user = request.isEmail
          ? await this.userRepository.findByEmailCaseInsensitive(identifier)
          : (await this.userRepository.findByPhoneNumber(identifier)) ??
            (await this.userRepository.findByNormalizedPhoneNumber(identifier));

        if (!user) {
          return failure("USER_NOT_FOUND", "User not found", undefined, 404);
        }

        const tokens = await this.sessionTokenService.issueTokens(user.id, {
          emailVerified: request.isEmail ? true : undefined,
          phoneVerified: request.isEmail ? undefined : true,
          context: "Login",
        });

        return success(tokens, "Login successful");
      }

      const trimmedName = request.name?.trim();
      if (!trimmedName) {
        return failure("INVALID_NAME", "Name is required for registration", undefined, 400);
      }

      // Wrap DB operations in transaction
      try {
        const created = await withTransaction(this.db, async (tx) => {
          // Prevent duplicate accounts (within transaction)
          if (request.isEmail) {
            const existing = await this.userRepository.findByEmailCaseInsensitive(identifier, tx);
            if (existing) {
              throw new Error("ACCOUNT_EXISTS: An account with this email already exists");
            }
          } else {
            const existingPhone =
              (await this.userRepository.findByPhoneNumber(identifier, tx)) ||
              (await this.userRepository.findByNormalizedPhoneNumber(identifier, tx));
            if (existingPhone) {
              throw new Error("ACCOUNT_EXISTS: An account with this phone number already exists");
            }
          }

          // Create user
          const user = await this.userRepository.create(
            {
              name: trimmedName,
              email: request.isEmail ? normalizeEmail(identifier) : null,
              phoneNumber: request.isEmail ? null : sanitizePhone(identifier),
              authProvider: "Registration",
              providerId: null,
            },
            tx
          );

          // Mark verified
          if (request.isEmail) {
            await this.userRepository.markEmailVerified(user.id, tx);
          } else {
            await this.userRepository.markPhoneVerified(user.id, tx);
          }

          return user;
        });

        // Issue tokens after successful transaction
        const tokens = await this.sessionTokenService.issueTokens(created.id, {
          emailVerified: request.isEmail ? true : undefined,
          phoneVerified: request.isEmail ? undefined : true,
          context: "Registration",
        });

        return success(tokens, "Registration successful");
      } catch (dbError) {
        // Handle duplicate account error (from transaction)
        const errorMsg = String(dbError);
        if (errorMsg.includes("ACCOUNT_EXISTS")) {
          return failure("ACCOUNT_EXISTS", errorMsg.replace("ACCOUNT_EXISTS: ", ""), undefined, 409);
        }

        // Log failed registration (Twilio verified but DB failed)
        this.logger.error("Database operations failed after Twilio verification", {
          identifier,
          error: errorMsg,
        });

        return failure("REGISTRATION_FAILED", "Failed to create user account", undefined, 500);
      }
    } catch (error) {
      this.logger.error("Verify code flow failed", { error: String(error) });
      return failure("VERIFY_FAILED", "Failed to process verification", undefined, 500);
    }
  }

  async refreshTokens(request: RefreshTokenRequest): Promise<ServiceResult<JwtTokens>> {
    if (!request.refreshToken) {
      return failure("INVALID_REFRESH", "Refresh token is required", undefined, 400);
    }

    const valid = await this.jwtService.validateRefreshToken(request.refreshToken);
    if (!valid) {
      return failure("INVALID_REFRESH", "Invalid refresh token", undefined, 401);
    }

    const userId = await this.jwtService.getUserIdFromRefreshToken(request.refreshToken);
    if (!userId) {
      return failure("INVALID_REFRESH", "Unable to resolve user for refresh token", undefined, 401);
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.generateAccessToken(userId),
      this.jwtService.generateRefreshToken(userId),
    ]);

    return success({ accessToken, refreshToken, userId }, "Token refresh completed");
  }

  async verifyApple(request: AppleAuthRequest): Promise<ServiceResult<JwtTokens>> {
    try {
      const appleInfo = await this.appleVerifier.verifyIdToken(request.idToken);

      const externalInfo: OAuthUserInfo = {
        provider: "apple",
        providerId: appleInfo.appleUserId,
        email: appleInfo.email,
        name: request.givenName || request.familyName ? `${request.givenName ?? ""} ${request.familyName ?? ""}`.trim() : appleInfo.name,
        emailVerified: appleInfo.emailVerified,
      };

      const userId = await this.oauthUserLinkService.findOrCreate(externalInfo);

      const tokens = await this.sessionTokenService.issueTokens(userId, {
        emailVerified: appleInfo.emailVerified,
        context: "Apple Sign-In",
      });

      return success(tokens, "Apple Sign-In completed");
    } catch (error) {
      this.logger.error("Apple verification failed", { error: String(error) });
      return failure("APPLE_VERIFY_FAILED", "Failed to verify Apple token", undefined, 400);
    }
  }

  async verifyGoogle(request: GoogleAuthRequest): Promise<ServiceResult<JwtTokens>> {
    try {
      const googleInfo = await this.googleVerifier.verifyIdToken(request.idToken);

      const externalInfo: OAuthUserInfo = {
        provider: "google",
        providerId: googleInfo.googleUserId,
        email: googleInfo.email,
        name: googleInfo.name,
        emailVerified: googleInfo.emailVerified,
      };

      const userId = await this.oauthUserLinkService.findOrCreate(externalInfo);
      const tokens = await this.sessionTokenService.issueTokens(userId, {
        emailVerified: googleInfo.emailVerified,
        context: "Google Sign-In",
      });

      return success(tokens, "Google Sign-In completed");
    } catch (error) {
      this.logger.error("Google verification failed", { error: String(error) });
      return failure("GOOGLE_VERIFY_FAILED", "Failed to verify Google token", undefined, 400);
    }
  }
}
