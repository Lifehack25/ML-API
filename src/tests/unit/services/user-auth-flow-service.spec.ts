import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { UserAuthFlowService } from '../../../services/user-auth-flow-service';
import type { UserRepository } from '../../../data/repositories/user-repository';
import type { TwilioVerifyClient } from '../../../infrastructure/Auth/twilio';
import type { JwtService } from '../../../infrastructure/Auth/jwt';
import type { SessionTokenService } from '../../../services/session-token-service';
import type { OAuthUserLinkService } from '../../../services/oauth-user-link-service';
import type { AppleVerifier } from '../../../infrastructure/Auth/oauth-apple';
import type { GoogleVerifier } from '../../../infrastructure/Auth/oauth-google';
import type { DrizzleClient } from '../../../data/db';
import type { Logger } from '../../../common/logger';

// Mocks
const mockDb = {} as DrizzleClient; // DB is opaque in service
const mockUserRepository = {
    findByEmailCaseInsensitive: vi.fn(),
    findByPhoneNumber: vi.fn(),
    findByNormalizedPhoneNumber: vi.fn(),
    create: vi.fn(),
} as unknown as Mocked<UserRepository>;

const mockTwilio = {
    sendEmailVerification: vi.fn(),
    sendSmsVerification: vi.fn(),
    verifyCode: vi.fn(),
} as unknown as Mocked<TwilioVerifyClient>;

const mockJwtService = {
    validateRefreshToken: vi.fn(),
    getUserIdFromRefreshToken: vi.fn(),
    generateAccessToken: vi.fn(),
    generateRefreshToken: vi.fn(),
} as unknown as Mocked<JwtService>;

const mockSessionTokenService = {
    issueTokens: vi.fn(),
} as unknown as Mocked<SessionTokenService>;

const mockOAuthLink = {
    findOrCreate: vi.fn(),
} as unknown as Mocked<OAuthUserLinkService>;

const mockApple = { verifyIdToken: vi.fn() } as unknown as Mocked<AppleVerifier>;
const mockGoogle = { verifyIdToken: vi.fn() } as unknown as Mocked<GoogleVerifier>;
const mockLogger = { error: vi.fn(), info: vi.fn() } as unknown as Mocked<Logger>;

describe('UserAuthFlowService', () => {
    let service: UserAuthFlowService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new UserAuthFlowService(
            mockDb,
            mockUserRepository,
            mockTwilio,
            mockJwtService,
            mockSessionTokenService,
            mockOAuthLink,
            mockApple,
            mockGoogle,
            mockLogger
        );
    });

    describe('sendVerificationCode', () => {
        it('should fail with invalid identifier', async () => {
            const result = await service.sendVerificationCode({
                identifier: '',
                isEmail: true,
                isLogin: true,
            });
            if (result.ok) throw new Error('Expected failure');

            expect(result.ok).toBe(false);
            expect(result.error.code).toBe('INVALID_IDENTIFIER');
        });

        it('should return success without sending code if login requested for non-existent user', async () => {
            vi.spyOn(mockUserRepository, 'findByEmailCaseInsensitive').mockResolvedValue(null);

            const result = await service.sendVerificationCode({
                identifier: 'test@example.com',
                isEmail: true,
                isLogin: true,
            });

            if (!result.ok) throw new Error('Expected success');

            expect(result.ok).toBe(true);
            expect(result.message).toBe('User not found');
            expect(mockTwilio.sendEmailVerification).not.toHaveBeenCalled();
        });

        it('should return success without sending code if registration requested for existing user', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn(mockUserRepository, 'findByEmailCaseInsensitive').mockResolvedValue({ id: 1 } as any);

            const result = await service.sendVerificationCode({
                identifier: 'test@example.com',
                isEmail: true,
                isLogin: false,
            });

            if (!result.ok) throw new Error('Expected success');

            expect(result.ok).toBe(true);
            expect(result.message).toBe('User already exists');
            expect(mockTwilio.sendEmailVerification).not.toHaveBeenCalled();
        });

        it('should send email code for valid login request', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn(mockUserRepository, 'findByEmailCaseInsensitive').mockResolvedValue({ id: 1 } as any);
            mockTwilio.sendEmailVerification.mockResolvedValue(true);

            const result = await service.sendVerificationCode({
                identifier: 'test@example.com',
                isEmail: true,
                isLogin: true,
            });

            if (!result.ok) throw new Error('Expected success');

            expect(result.ok).toBe(true);
            expect(mockTwilio.sendEmailVerification).toHaveBeenCalledWith('test@example.com');
        });
    });

    describe('verifyCode', () => {
        it('should fail if code is invalid', async () => {
            mockTwilio.verifyCode.mockResolvedValue(false);

            const result = await service.verifyCode({
                identifier: 'test@example.com',
                isEmail: true,
                verifyCode: '123456',
            });

            if (result.ok) throw new Error('Expected failure');

            expect(result.ok).toBe(false);
            expect(result.error.code).toBe('INVALID_CODE');
        });

        it('should login existing user successfully', async () => {
            mockTwilio.verifyCode.mockResolvedValue(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn(mockUserRepository, 'findByEmailCaseInsensitive').mockResolvedValue({ id: 1 } as any);
            mockSessionTokenService.issueTokens.mockResolvedValue({
                accessToken: 'access',
                refreshToken: 'refresh',
                userId: 1,
            });

            const result = await service.verifyCode({
                identifier: 'test@example.com',
                isEmail: true,
                verifyCode: '123456',
            });

            if (!result.ok) throw new Error('Expected success');

            expect(result.ok).toBe(true);
            expect(mockSessionTokenService.issueTokens).toHaveBeenCalledWith(1, expect.anything());
        });

        it('should register new user successfully', async () => {
            mockTwilio.verifyCode.mockResolvedValue(true);
            vi.spyOn(mockUserRepository, 'findByEmailCaseInsensitive').mockResolvedValue(null);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            vi.spyOn(mockUserRepository, 'create').mockResolvedValue({ id: 2 } as any);
            mockSessionTokenService.issueTokens.mockResolvedValue({
                accessToken: 'access',
                refreshToken: 'refresh',
                userId: 2,
            });

            const result = await service.verifyCode({
                identifier: 'new@example.com',
                isEmail: true,
                verifyCode: '123456',
                name: 'New User'
            });

            if (!result.ok) throw new Error('Expected success');

            expect(result.ok).toBe(true);
            expect(mockUserRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                email: 'new@example.com',
                name: 'New User'
            }));
        });
    });
});
