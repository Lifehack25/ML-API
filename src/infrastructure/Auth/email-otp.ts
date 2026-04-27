import { EmailMessage } from 'cloudflare:email';

export interface EmailOtpClient {
  sendCode(email: string): Promise<boolean>;
  verifyCode(email: string, code: string): Promise<boolean>;
}

const OTP_TTL_SECONDS = 600;
const KV_PREFIX = 'otp:email:';
const SENDER = 'noreply@memorylocks.com';

const generateCode = (): string => {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
};

const buildRawEmail = (to: string, code: string): string => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
  <style>
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f7; color: #51545E; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .content-cell { padding: 30px 20px !important; }
      .code-box { letter-spacing: 5px !important; font-size: 28px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f7;">

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f7;">
    <tr>
      <td align="center" style="padding: 40px 0;">

        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">

          <tr>
            <td bgcolor="#FFD9DD" style="height: 6px;"></td>
          </tr>

          <tr>
            <td class="content-cell" style="padding: 45px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">

                <tr>
                  <td align="center" style="padding-bottom: 25px;">
                    <img src="https://imagedelivery.net/Fh6D8c3CvE0G8hv20vsbkw/43379da0-d88a-42ea-fec6-7b345c7e2800/standard" alt="Logo" width="120" style="display: block; width: 120px; max-width: 100%; height: auto; border: 0;">
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding-bottom: 15px;">
                    <h2 style="margin: 0; font-size: 20px; color: #333333; font-weight: 600;">Verification Code</h2>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding-bottom: 30px; font-size: 16px; line-height: 1.6; color: #51545E;">
                    Please use the code below to verify yourself.
                  </td>
                </tr>

                <tr>
                  <td align="center">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="code-box" style="background-color: #f4f4f7; border: 1px border-style: dashed; border-color: #e0e0e0; border-radius: 6px; padding: 20px 40px; font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #333333;">
                          ${code}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding-top: 30px; font-size: 14px; color: #888888;">
                    This code will expire in 10 minutes.<br>
                    If you didn't request this code, you can safely ignore this email.
                  </td>
                </tr>

              </table>
            </td>
          </tr>

        </table>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="center" style="padding-top: 20px; padding-bottom: 20px; font-size: 12px; color: #999999;">
              <p style="margin: 0;">&copy; 2026 Memory Locks. All rights reserved.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const messageId = `otp.${Date.now()}.${Math.random().toString(36).slice(2)}@memorylocks.com`;
  const headers = [
    'MIME-Version: 1.0',
    `From: Memory Locks <${SENDER}>`,
    `To: ${to}`,
    'Subject: Your Memory Locks Verification Code',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    `Message-ID: <${messageId}>`,
    `Date: ${new Date().toUTCString()}`,
  ].join('\r\n');

  return `${headers}\r\n\r\n${html}`;
};

export const createEmailOtpClient = (kv: KVNamespace, mailer: SendEmail): EmailOtpClient => {
  return {
    async sendCode(email: string): Promise<boolean> {
      const normalized = email.trim().toLowerCase();
      const code = generateCode();
      await kv.put(`${KV_PREFIX}${normalized}`, code, { expirationTtl: OTP_TTL_SECONDS });
      const raw = buildRawEmail(email, code);
      const message = new EmailMessage(SENDER, email, raw);
      await mailer.send(message);
      return true;
    },

    async verifyCode(email: string, code: string): Promise<boolean> {
      const normalized = email.trim().toLowerCase();
      const stored = await kv.get(`${KV_PREFIX}${normalized}`);
      if (!stored || stored !== code.trim()) {
        return false;
      }
      await kv.delete(`${KV_PREFIX}${normalized}`);
      return true;
    },
  };
};
