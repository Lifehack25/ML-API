import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { JwtConfig } from '../../config/env';

interface JwtClaims extends JWTPayload {
  userId: number;
  tokenType: 'access' | 'refresh';
}

export interface JwtService {
  generateAccessToken(userId: number): Promise<string>;
  generateRefreshToken(userId: number): Promise<string>;
  validateRefreshToken(token: string): Promise<boolean>;
  getUserIdFromRefreshToken(token: string): Promise<number | null>;
}

const encoder = new TextEncoder();

export const createJwtService = (config: JwtConfig): JwtService => {
  const key = encoder.encode(config.secret);

  const sign = async (
    userId: number,
    tokenType: 'access' | 'refresh',
    expiresInMinutes: number
  ): Promise<string> => {
    const jwt = new SignJWT({ userId, tokenType })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject(String(userId))
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${expiresInMinutes}m`);

    return jwt.sign(key);
  };

  const verify = async (token: string): Promise<JwtClaims | null> => {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: config.issuer,
        audience: config.audience,
      });

      if (
        typeof payload.userId !== 'number' ||
        (payload.tokenType !== 'access' && payload.tokenType !== 'refresh')
      ) {
        return null;
      }

      return payload as JwtClaims;
    } catch {
      return null;
    }
  };

  return {
    generateAccessToken: (userId) => sign(userId, 'access', config.accessTokenExpiryHours * 60),
    generateRefreshToken: (userId) =>
      sign(userId, 'refresh', config.refreshTokenExpiryDays * 24 * 60),
    validateRefreshToken: async (token) => {
      const result = await verify(token);
      return result?.tokenType === 'refresh' || false;
    },
    getUserIdFromRefreshToken: async (token) => {
      const result = await verify(token);
      return result?.tokenType === 'refresh' ? result.userId : null;
    },
  };
};
