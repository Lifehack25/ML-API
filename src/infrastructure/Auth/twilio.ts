import { TwilioConfig } from '../../config/env';

export interface TwilioVerifyClient {
  sendEmailVerification(to: string): Promise<boolean>;
  sendSmsVerification(to: string): Promise<boolean>;
  verifyCode(to: string, code: string): Promise<boolean>;
}

const createAuthHeader = (config: TwilioConfig): string => {
  const credentials = `${config.accountSid}:${config.authToken}`;
  const encoded = btoa(credentials);
  return `Basic ${encoded}`;
};

const formEncode = (data: Record<string, string>) =>
  Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

export const createTwilioVerifyClient = (config: TwilioConfig): TwilioVerifyClient => {
  const baseUrl = `https://verify.twilio.com/v2/Services/${config.verifyServiceSid}`;
  const headers = {
    Authorization: createAuthHeader(config),
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const request = async (path: string, body: Record<string, string>): Promise<Response> => {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formEncode(body),
    });
  };

  const sendVerification = async (to: string, channel: 'sms' | 'email'): Promise<boolean> => {
    const response = await request('/Verifications', {
      To: to,
      Channel: channel,
    });

    if (!response.ok) {
      console.warn('Twilio verification request failed', {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    const payload = await response.json<{ status?: string }>().catch(() => ({ status: undefined }));
    return payload.status === 'pending';
  };

  return {
    sendEmailVerification: (to) => sendVerification(to, 'email'),
    sendSmsVerification: (to) => sendVerification(to, 'sms'),
    verifyCode: async (to, code) => {
      const response = await request('/VerificationCheck', {
        To: to,
        Code: code,
      });

      if (!response.ok) {
        console.warn('Twilio verification check failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return false;
      }

      const payload = await response
        .json<{ status?: string }>()
        .catch(() => ({ status: undefined }));
      return payload.status === 'approved';
    },
  };
};
