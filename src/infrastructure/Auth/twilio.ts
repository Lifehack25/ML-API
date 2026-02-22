import { TwilioConfig } from '../../config/env';

export interface TwilioVerifyClient {
  sendEmailVerification(to: string): Promise<boolean>;
  sendSmsVerification(to: string): Promise<boolean>;
  verifyCode(to: string, code: string): Promise<boolean>;
}

interface TwilioApiErrorPayload {
  code?: number;
  message?: string;
  more_info?: string;
  status?: number;
}

export class TwilioRequestError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly twilioCode?: number,
    public readonly twilioMessage?: string,
    public readonly moreInfo?: string
  ) {
    super(twilioMessage || `Twilio request failed (${httpStatus})`);
    this.name = 'TwilioRequestError';
  }
}

export const isTwilioRequestError = (error: unknown): error is TwilioRequestError =>
  error instanceof TwilioRequestError;

const createAuthHeader = (config: TwilioConfig): string => {
  const credentials = `${config.accountSid}:${config.authToken}`;
  const encoded = btoa(credentials);
  return `Basic ${encoded}`;
};

const formEncode = (data: Record<string, string>) => new URLSearchParams(data).toString();

const parseErrorPayload = (raw: string): TwilioApiErrorPayload | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as TwilioApiErrorPayload;
    }
    return null;
  } catch {
    return null;
  }
};

export const createTwilioVerifyClient = (config: TwilioConfig): TwilioVerifyClient => {
  const baseUrl = `https://verify.twilio.com/v2/Services/${config.verifyServiceSid}`;
  const headers = {
    Authorization: createAuthHeader(config),
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  const request = async (path: string, body: Record<string, string>): Promise<Response> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formEncode(body),
    });

    if (!response.ok) {
      const raw = await response.text();
      const payload = parseErrorPayload(raw);
      const twilioMessage = payload?.message?.trim() || undefined;

      console.warn('Twilio verification request failed', {
        status: response.status,
        statusText: response.statusText,
        twilioCode: payload?.code,
        twilioMessage,
        moreInfo: payload?.more_info,
      });

      throw new TwilioRequestError(
        response.status,
        payload?.code,
        twilioMessage,
        payload?.more_info
      );
    }

    return response;
  };

  const sendVerification = async (to: string, channel: 'sms' | 'email'): Promise<boolean> => {
    const response = await request('/Verifications', {
      To: to,
      Channel: channel,
    });

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

      const payload = await response
        .json<{ status?: string }>()
        .catch(() => ({ status: undefined }));
      return payload.status === 'approved';
    },
  };
};
