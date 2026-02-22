import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Idempotency keys table.
 * Used to deduplicate incoming requests and store cached responses.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(), // format: "endpoint:idempotency_key"
    status: integer('status').notNull(), // HTTP status code
    body: text('body'), // JSON stringified response body
    created_at: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    keyIdx: index('idx_idempotency_key').on(table.key),
    createdAtIdx: index('idx_idempotency_created_at').on(table.created_at),
  })
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyKey = typeof idempotencyKeys.$inferInsert;
