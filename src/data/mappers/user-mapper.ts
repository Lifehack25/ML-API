import type { User } from "../schema";
import type { UserProfile } from "../../services/dtos/users";

const toBoolean = (value: number | boolean | null | undefined): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return false;
};

export const mapUserRowToProfile = (row: User): UserProfile => ({
  id: row.id,
  name: row.name ?? "",
  email: row.email,
  phoneNumber: row.phone_number,
  emailVerified: toBoolean(row.email_verified),
  phoneVerified: toBoolean(row.phone_verified),
  authProvider: row.auth_provider,
  providerId: row.provider_id,
  deviceToken: row.device_token,
});

