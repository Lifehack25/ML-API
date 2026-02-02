import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { AppleConfig } from '../../config/env';

export interface AppleUserInfo {
  appleUserId: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

export interface AppleVerifier {
  verifyIdToken(idToken: string): Promise<AppleUserInfo>;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const parseBooleanClaim = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
};

export const createAppleVerifier = (config?: AppleConfig): AppleVerifier => {
  if (!config) {
    return {
      async verifyIdToken() {
        throw new Error('Apple Sign-In is not configured');
      },
    };
  }

  return {
    verifyIdToken: async (idToken: string) => {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: APPLE_ISSUER,
        audience: config.bundleId,
      });

      if (!payload.sub) {
        throw new Error('Apple token missing subject');
      }

      const extractName = (claims: JWTPayload): string | undefined => {
        if (typeof claims.name === 'string' && claims.name.trim().length > 0) {
          return claims.name.trim();
        }

        const givenName = typeof claims.given_name === 'string' ? claims.given_name : undefined;
        const familyName = typeof claims.family_name === 'string' ? claims.family_name : undefined;

        if (givenName || familyName) {
          return `${givenName ?? ''} ${familyName ?? ''}`.trim();
        }

        return undefined;
      };

      return {
        appleUserId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified: parseBooleanClaim(payload.email_verified),
        name: extractName(payload),
      } satisfies AppleUserInfo;
    },
  };
};
