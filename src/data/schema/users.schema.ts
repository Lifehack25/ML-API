import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * User accounts table.
 * Stores authentication provider details and profile information.
 */
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name'),
    email: text('email'),
    phone_number: text('phone_number'),
    // Auth provider (e.g., 'google', 'apple', 'phone')
    auth_provider: text('auth_provider').notNull().default(''),
    // UID from the auth provider
    provider_id: text('provider_id'),
    email_verified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    phone_verified: integer('phone_verified', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    last_login_at: text('last_login_at'),
    device_token: text('device_token'), // FCM token for push notifications
    last_notification_prompt: text('last_notification_prompt'),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    phoneIdx: index('idx_users_phone').on(table.phone_number),
    providerIdx: index('idx_users_provider').on(table.auth_provider, table.provider_id),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
