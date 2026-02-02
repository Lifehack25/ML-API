import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { locks } from './locks.schema';

export const mediaObjects = sqliteTable(
  'media_objects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lock_id: integer('lock_id')
      .notNull()
      .references(() => locks.id, { onDelete: 'cascade' }),
    cloudflare_id: text('cloudflare_id').notNull().default(''),
    url: text('url').notNull().default(''),
    thumbnail_url: text('thumbnail_url'),
    file_name: text('file_name'),
    is_image: integer('is_image').notNull().default(1),
    is_main_picture: integer('is_main_picture', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    display_order: integer('display_order').notNull().default(0),
    duration_seconds: integer('duration_seconds'),
  },
  (table) => ({
    lockIdIdx: index('idx_media_objects_lock_id').on(table.lock_id),
    displayOrderIdx: index('idx_media_objects_display_order').on(
      table.lock_id,
      table.display_order
    ),
    // Ensure each Cloudflare asset is referenced at most once
    cloudflareIdUniqueIdx: uniqueIndex('idx_media_objects_cloudflare_id').on(table.cloudflare_id),
    // Unique constraint: only one main picture per lock
    mainPictureIdx: uniqueIndex('idx_media_one_main_image')
      .on(table.lock_id)
      .where(sql`${table.is_main_picture} = 1`),
  })
);

export type MediaObject = typeof mediaObjects.$inferSelect;
export type InsertMediaObject = typeof mediaObjects.$inferInsert;
