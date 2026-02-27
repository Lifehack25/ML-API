import { Logger } from '../common/logger';
import { MailerLiteConfig } from '../config/env';

export class MailerLiteClient {
  private readonly baseUrl = 'https://connect.mailerlite.com/api';

  constructor(
    private readonly config: MailerLiteConfig,
    private readonly logger: Logger
  ) {}

  async addSubscriber(
    email: string,
    name?: string | null,
    groupId?: string,
    origin?: string
  ): Promise<void> {
    const url = `${this.baseUrl}/subscribers`;
    const groups = groupId ? [groupId] : undefined;
    const fields: Record<string, string> = {};

    if (name?.trim()) {
      fields.name = name.trim();
    }

    if (origin?.trim()) {
      fields.Origin = origin.trim();
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email,
          fields: Object.keys(fields).length > 0 ? fields : undefined,
          groups,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('Failed to add MailerLite subscriber', {
          status: response.status,
          error: errorText,
        });
      } else {
        this.logger.info('Successfully added MailerLite subscriber', { email });
      }
    } catch (error) {
      this.logger.error('Error calling MailerLite API', { error: String(error) });
    }
  }
}

export const createMailerLiteClient = (
  config: MailerLiteConfig,
  logger: Logger
): MailerLiteClient => {
  return new MailerLiteClient(config, logger);
};
