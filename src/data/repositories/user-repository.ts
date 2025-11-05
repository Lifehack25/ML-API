import type { UserRow } from "../models/user";
import type { D1Result } from "./types";
import type { CreateUserRequest } from "../../business/dtos/users";
import { getTransactionDb } from "../transaction";

const sanitizePhone = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/[\s\-()+]/g, "");
};

export class UserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: number, txDb?: D1Database): Promise<UserRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async create(data: CreateUserRequest, txDb?: D1Database): Promise<UserRow> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();
    const payload = {
      name: data.name.trim(),
      email: data.email ?? null,
      phone_number: data.phoneNumber ?? null,
      auth_provider: data.authProvider ?? "",
      provider_id: data.providerId ?? null,
      email_verified: 0,
      phone_verified: 0,
      created_at: now,
      last_login_at: null as string | null,
    };

    const result: D1Result = await db
      .prepare(
        `INSERT INTO users (
            name, email, phone_number, auth_provider, provider_id,
            email_verified, phone_verified, created_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        payload.name,
        payload.email,
        payload.phone_number,
        payload.auth_provider,
        payload.provider_id,
        payload.email_verified,
        payload.phone_verified,
        payload.created_at,
        payload.last_login_at
      )
      .run();

    if (!result.success) {
      throw new Error("Failed to create user");
    }

    const created = await this.findById(result.meta.last_row_id!, db);
    if (!created) {
      throw new Error("Failed to load created user");
    }

    return created;
  }

  async findByEmail(email: string, txDb?: D1Database): Promise<UserRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByEmailCaseInsensitive(email: string, txDb?: D1Database): Promise<UserRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)")
      .bind(email)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByPhoneNumber(phoneNumber: string, txDb?: D1Database): Promise<UserRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare("SELECT * FROM users WHERE phone_number = ?")
      .bind(phoneNumber)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByNormalizedPhoneNumber(phoneNumber: string, txDb?: D1Database): Promise<UserRow | null> {
    const normalized = sanitizePhone(phoneNumber);
    if (!normalized) return null;

    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare(
        `SELECT * FROM users
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone_number, " ", ""), "-", ""), "(", ""), ")", ""), "+", "") = ?`
      )
      .bind(normalized)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async findByProvider(authProvider: string, providerId: string, txDb?: D1Database): Promise<UserRow | null> {
    const db = getTransactionDb(this.db, txDb);
    const result: D1Result<UserRow> = await db
      .prepare("SELECT * FROM users WHERE auth_provider = ? AND provider_id = ?")
      .bind(authProvider, providerId)
      .all();

    if (!result.success || result.results.length === 0) {
      return null;
    }

    return result.results[0];
  }

  async linkProvider(userId: number, authProvider: string, providerId: string, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET auth_provider = ?, provider_id = ? WHERE id = ?")
      .bind(authProvider, providerId, userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to link OAuth provider to user");
    }
  }

  async updateEmail(userId: number, email: string | null, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET email = ? WHERE id = ?")
      .bind(email, userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to update user email");
    }
  }

  async updatePhoneNumber(userId: number, phoneNumber: string | null, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET phone_number = ? WHERE id = ?")
      .bind(phoneNumber, userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to update user phone number");
    }
  }

  async updateName(userId: number, name: string, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET name = ? WHERE id = ?")
      .bind(name, userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to update user name");
    }
  }

  async markEmailVerified(userId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to mark email as verified");
    }
  }

  async markPhoneVerified(userId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db
      .prepare("UPDATE users SET phone_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to mark phone as verified");
    }
  }

  async updateAuthMetadata(
    userId: number,
    metadata: { emailVerified?: boolean; phoneVerified?: boolean; lastLoginAt?: string },
    txDb?: D1Database
  ): Promise<void> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (typeof metadata.emailVerified === "boolean") {
      updates.push("email_verified = ?");
      values.push(metadata.emailVerified ? 1 : 0);
    }

    if (typeof metadata.phoneVerified === "boolean") {
      updates.push("phone_verified = ?");
      values.push(metadata.phoneVerified ? 1 : 0);
    }

    if (metadata.lastLoginAt) {
      updates.push("last_login_at = ?");
      values.push(metadata.lastLoginAt);
    }

    if (updates.length === 0) {
      return;
    }

    values.push(userId);

    const db = getTransactionDb(this.db, txDb);
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
    const result = await db.prepare(query).bind(...values).run();

    if (!result.success) {
      throw new Error("Failed to update authentication metadata");
    }
  }

  async updateDeviceToken(userId: number, deviceToken: string, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const now = new Date().toISOString();
    const result = await db
      .prepare("UPDATE users SET device_token = ?, last_notification_prompt = ? WHERE id = ?")
      .bind(deviceToken, now, userId)
      .run();

    if (!result.success) {
      throw new Error("Failed to update device token");
    }
  }

  async delete(userId: number, txDb?: D1Database): Promise<void> {
    const db = getTransactionDb(this.db, txDb);
    const result = await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    if (!result.success) {
      throw new Error("Failed to delete user");
    }
  }
}

