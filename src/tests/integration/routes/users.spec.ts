import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../../../index';
import { mockConfig } from '../../mocks';
import { success, failure } from '../../../common/result';

// Mock the container/services
// We need to mock createRequestContext to return our mocked services
const mockAuthService = {
  sendVerificationCode: vi.fn(),
  verifyCode: vi.fn(),
  refreshTokens: vi.fn(),
  verifyApple: vi.fn(),
  verifyGoogle: vi.fn(),
};

const mockUserService = {
  getProfile: vi.fn(),
  updateName: vi.fn(),
  updateDeviceToken: vi.fn(),
  deleteAccount: vi.fn(),
  removeIdentifier: vi.fn(),
  verifyIdentifier: vi.fn(),
  resendTwilioCode: vi.fn(),
};

const mockIdempotencyService = {
  checkIdempotency: vi.fn().mockResolvedValue(null),
  storeResult: vi.fn(),
};

// Mock the entire context creation
vi.mock('../../../common/context', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(actual as any),
    createRequestContext: vi.fn(() => ({
      services: {
        auth: mockAuthService,
        users: mockUserService,
      },
      idempotencyService: mockIdempotencyService,
    })),
  };
});

// Mock validation middleware to pass through (or let zod handle it if we want validation tests)
// Since we are testing integration of the router with validation, strictly speaking we should let Zod run.
// But we want to mock the SERVICE implementation.

describe('User Routes Integration', () => {
  const app = buildApp(mockConfig);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /users/verify/send-code', () => {
    it('should call authService.sendVerificationCode and return 200 on success', async () => {
      mockAuthService.sendVerificationCode.mockResolvedValue(success({ message: 'Code sent' }));

      const res = await app.request(
        '/users/verify/send-code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isLogin: true,
            isEmail: true,
            identifier: 'test@example.com',
          }),
        },
        {},
        executionCtx
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Code sent' });
      expect(mockAuthService.sendVerificationCode).toHaveBeenCalled();
    });

    it('should return 400 on service failure', async () => {
      mockAuthService.sendVerificationCode.mockResolvedValue(
        failure('INVALID_IDENTIFIER', 'Bad email')
      );

      const res = await app.request(
        '/users/verify/send-code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isLogin: true,
            isEmail: true,
            identifier: 'bad-email',
          }),
        },
        {},
        executionCtx
      );

      expect(res.status).toBe(400); // Service failure default status
      const body = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((body as any).code).toBe('INVALID_IDENTIFIER');
    });

    it('should return 400 on validation error (invalid email format logic handled by zod if we added regex, but min length is 3)', async () => {
      // Checking Zod validation
      const res = await app.request(
        '/users/verify/send-code',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isLogin: true,
            isEmail: true,
            identifier: '', // Too short
          }),
        },
        {},
        executionCtx
      );

      expect(res.status).toBe(400);
      // We aren't checking specific zod error structure here, just that it rejected before service calls
      expect(mockAuthService.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('POST /users/verify/verify-code', () => {
    it('should return tokens on success', async () => {
      const mockTokens = { accessToken: 'acc', refreshToken: 'ref', userId: 1 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockUserService.verifyIdentifier.mockResolvedValue(success(true) as any);
      mockAuthService.verifyCode.mockResolvedValue(success(mockTokens));

      const res = await app.request(
        '/users/verify/verify-code',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'test-key',
          },
          body: JSON.stringify({
            isEmail: true,
            identifier: 'test@example.com',
            verifyCode: '123456',
          }),
        },
        {},
        executionCtx
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(mockTokens);
    });
  });
});
