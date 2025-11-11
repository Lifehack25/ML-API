import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users.schema";

export const locks = sqliteTable(
  "locks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lock_name: text("lock_name").notNull().default("Memory Lock"),
    album_title: text("album_title").notNull().default("Wonderful Memories"),
    seal_date: text("seal_date"), // DATE stored as TEXT in SQLite
    scan_count: integer("scan_count").notNull().default(0),
    last_scan_milestone: integer("last_scan_milestone").notNull().default(0),
    created_at: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    user_id: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    upgraded_storage: integer("upgraded_storage").notNull().default(0),
  },
  (table) => ({
    userIdIdx: index("idx_locks_user_id").on(table.user_id),
  })
);

export type Lock = typeof locks.$inferSelect;
export type InsertLock = typeof locks.$inferInsert;
