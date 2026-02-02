import { GoogleConfig } from '../../config/env';

export interface GoogleUserInfo {
  googleUserId: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

export interface GoogleVerifier {
  verifyIdToken(idToken: string): Promise<GoogleUserInfo>;
}

const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

export const createGoogleVerifier = (config: GoogleConfig): GoogleVerifier => {
  const validAudiences = [config.androidClientId, config.iosClientId].filter(
    (value): value is string => Boolean(value)
  );

  return {
    verifyIdToken: async (idToken: string) => {
      // Use POST request with token in body instead of GET with token in URL
      // This prevents token leakage in server logs, browser history, and referrer headers
      const response = await fetch(TOKENINFO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `id_token=${encodeURIComponent(idToken)}`,
      });

      if (!response.ok) {
        throw new Error(`Google token verification failed (${response.status})`);
      }

      const payload = await response.json<{
        aud?: string;
        sub?: string;
        email?: string;
        email_verified?: string;
        name?: string;
      }>();

      if (!payload.sub) {
        throw new Error('Google ID token missing subject');
      }

      if (validAudiences.length > 0 && (!payload.aud || !validAudiences.includes(payload.aud))) {
        throw new Error('Google ID token has unexpected audience');
      }

      const emailVerified = (payload.email_verified ?? '').toLowerCase() === 'true';

      return {
        googleUserId: payload.sub,
        email: payload.email,
        emailVerified,
        name: payload.name,
      } satisfies GoogleUserInfo;
    },
  };
};
