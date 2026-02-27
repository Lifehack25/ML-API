import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';

/**
 * Digital locks (albums) table.
 * A lock represents a collection of media that can be sealed until a specific date.
 */
export const locks = sqliteTable(
  'locks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lock_name: text('lock_name').notNull().default('Memory Lock'),
    album_title: text('album_title').notNull().default('Wonderful Memories'),
    seal_date: text('seal_date'), // DATE stored as TEXT in SQLite (ISO 8601)
    scan_count: integer('scan_count').notNull().default(0), // Number of times the QR code has been scanned
    last_scan_milestone: integer('last_scan_milestone').notNull().default(0), // Last scan count milestone reached for notifications
    created_at: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    user_id: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    upgraded_storage: integer('upgraded_storage').notNull().default(0), // 0=free, 1=tier1, 2=tier2
    geo_location: text('geo_location'),
  },
  (table) => ({
    userIdIdx: index('idx_locks_user_id').on(table.user_id),
  })
);

export type Lock = typeof locks.$inferSelect;
export type InsertLock = typeof locks.$inferInsert;
