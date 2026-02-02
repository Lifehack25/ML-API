import { eq, and, sql } from "drizzle-orm";
import type { DrizzleClient } from "../db";
import { users, type User } from "../schema";
import type { CreateUserRequest } from "../../services/dtos/users";

const sanitizePhone = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/[\s\-()+]/g, "");
};

export class UserRepository {
  constructor(private readonly db: DrizzleClient) {}

  async findById(id: number): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] ?? null;
  }

  async create(data: CreateUserRequest): Promise<User> {
    const now = new Date().toISOString();
    const payload = {
      name: data.name.trim(),
      email: data.email ?? null,
      phone_number: data.phoneNumber ?? null,
      auth_provider: data.authProvider ?? "",
      provider_id: data.providerId ?? null,
      email_verified: data.emailVerified ?? false,
      phone_verified: data.phoneVerified ?? false,
      created_at: now,
      last_login_at: null as string | null,
    };

    const result = await this.db.insert(users).values(payload).returning();

    if (!result[0]) {
      throw new Error("Failed to create user");
    }

    return result[0];
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] ?? null;
  }

  async findByEmailCaseInsensitive(email: string): Promise<User | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email})`)
      .limit(1);
    return result[0] ?? null;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.phone_number, phoneNumber))
      .limit(1);
    return result[0] ?? null;
  }

  async findByNormalizedPhoneNumber(phoneNumber: string): Promise<User | null> {
    const normalized = sanitizePhone(phoneNumber);
    if (!normalized) return null;

    const result = await this.db
      .select()
      .from(users)
      .where(
        sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${users.phone_number}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ${normalized}`
      )
      .limit(1);
    return result[0] ?? null;
  }

  async findByProvider(authProvider: string, providerId: string): Promise<User | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(and(eq(users.auth_provider, authProvider), eq(users.provider_id, providerId)))
      .limit(1);
    return result[0] ?? null;
  }

  async linkProvider(userId: number, authProvider: string, providerId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ auth_provider: authProvider, provider_id: providerId })
      .where(eq(users.id, userId));
  }

  async updateEmail(userId: number, email: string | null): Promise<void> {
    await this.db.update(users).set({ email }).where(eq(users.id, userId));
  }

  async updatePhoneNumber(userId: number, phoneNumber: string | null): Promise<void> {
    await this.db.update(users).set({ phone_number: phoneNumber }).where(eq(users.id, userId));
  }

  async updateName(userId: number, name: string): Promise<void> {
    await this.db.update(users).set({ name }).where(eq(users.id, userId));
  }

  async markEmailVerified(userId: number): Promise<void> {
    await this.db.update(users).set({ email_verified: true }).where(eq(users.id, userId));
  }

  async markPhoneVerified(userId: number): Promise<void> {
    await this.db.update(users).set({ phone_verified: true }).where(eq(users.id, userId));
  }

  async updateAuthMetadata(
    userId: number,
    metadata: { emailVerified?: boolean; phoneVerified?: boolean; lastLoginAt?: string }
  ): Promise<void> {
    const updates: Partial<User> = {};

    if (typeof metadata.emailVerified === "boolean") {
      updates.email_verified = metadata.emailVerified;
    }

    if (typeof metadata.phoneVerified === "boolean") {
      updates.phone_verified = metadata.phoneVerified;
    }

    if (metadata.lastLoginAt) {
      updates.last_login_at = metadata.lastLoginAt;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    await this.db.update(users).set(updates).where(eq(users.id, userId));
  }

  async updateDeviceToken(userId: number, deviceToken: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(users)
      .set({ device_token: deviceToken, last_notification_prompt: now })
      .where(eq(users.id, userId));
  }

  async delete(userId: number): Promise<void> {
    await this.db.delete(users).where(eq(users.id, userId));
  }
}
