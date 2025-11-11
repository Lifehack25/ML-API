import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const cleanupJobs = sqliteTable(
  "cloudflare_cleanup_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cloudflare_id: text("cloudflare_id").notNull(),
    media_type: text("media_type", { enum: ["image", "video"] }).notNull(),
    retry_count: integer("retry_count").notNull().default(0),
    next_retry_at: text("next_retry_at"), // DATETIME stored as TEXT
    last_error: text("last_error"),
    status: text("status", { enum: ["pending", "completed", "failed"] })
      .notNull()
      .default("pending"),
    created_at: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updated_at: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    cloudflareIdIdx: index("idx_cleanup_jobs_cloudflare_id").on(
      table.cloudflare_id
    ),
    statusRetryIdx: index("idx_cleanup_jobs_status_retry").on(
      table.status,
      table.next_retry_at
    ),
  })
);

export type CleanupJob = typeof cleanupJobs.$inferSelect;
export type InsertCleanupJob = typeof cleanupJobs.$inferInsert;
