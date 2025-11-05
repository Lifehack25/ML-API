export interface UserRow {
  id: number;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  auth_provider: string;
  provider_id: string | null;
  email_verified: number | boolean;
  phone_verified: number | boolean;
  created_at: string;
  last_login_at: string | null;
  device_token: string | null;
  last_notification_prompt: string | null;
}

