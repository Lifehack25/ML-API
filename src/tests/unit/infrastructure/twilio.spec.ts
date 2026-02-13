import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTwilioVerifyClient,
  TwilioRequestError,
} from '../../../infrastructure/Auth/twilio';

describe('Twilio verify client', () => {
  const originalFetch = globalThis.fetch;

  const config = {
    accountSid: 'AC_TEST_ACCOUNT_SID',
    authToken: 'super-secret-token',
    verifyServiceSid: 'VA_TEST_VERIFY_SERVICE_SID',
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends SMS verification with form-encoded lowercase fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'pending' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;

    const client = createTwilioVerifyClient(config);
    const ok = await client.sendSmsVerification('+46739503820');

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://verify.twilio.com/v2/Services/VA_TEST_VERIFY_SERVICE_SID/Verifications'
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBe('to=%2B46739503820&channel=sms');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it('throws TwilioRequestError with parsed Twilio error payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 60203,
          message: 'Max send attempts reached',
          more_info: 'https://www.twilio.com/docs/errors/60203',
        }),
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    globalThis.fetch = fetchMock;

    const client = createTwilioVerifyClient(config);

    await expect(client.sendSmsVerification('+46739503820')).rejects.toMatchObject({
      name: 'TwilioRequestError',
      httpStatus: 429,
      twilioCode: 60203,
      twilioMessage: 'Max send attempts reached',
      moreInfo: 'https://www.twilio.com/docs/errors/60203',
    } satisfies Partial<TwilioRequestError>);
  });
});
