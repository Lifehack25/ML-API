/**
 * Drizzle Transaction Utilities
 *
 * Provides atomic multi-statement operations for Cloudflare D1 using Drizzle ORM.
 * D1 does NOT support explicit BEGIN/COMMIT/ROLLBACK SQL statements in Workers.
 * Use Drizzle's batch API for true ACID transaction semantics.
 *
 * @example Using batch API (preferred for atomic operations):
 * ```typescript
 * import { users, locks } from "./schema";
 *
 * await db.batch([
 *   db.delete(users).where(eq(users.id, userId)),
 *   db.update(locks).set({ user_id: null }).where(eq(locks.user_id, userId))
 * ]);
 * // All statements succeed or all fail (atomic)
 * ```
 *
 * Note: Drizzle's db.batch() provides atomic execution for D1.
 * All statements in the batch succeed together or fail together.
 */

import type { DrizzleClient } from "./db";

/**
 * Executes multiple Drizzle queries atomically using D1's batch API.
 * All statements succeed together or all fail together (true ACID semantics).
 *
 * @param db - Drizzle database client
 * @param queries - Array of Drizzle query builders
 * @returns Array of query results
 * @throws Error if any statement fails (automatic rollback)
 *
 * @example
 * ```typescript
 * import { mediaObjects, locks } from "./schema";
 * import { eq } from "drizzle-orm";
 *
 * const results = await withBatch(db, [
 *   db.delete(mediaObjects).where(eq(mediaObjects.id, mediaId)),
 *   db.update(locks).set({ album_title: "New Title" }).where(eq(locks.id, lockId))
 * ]);
 * // All succeed or all fail atomically
 * ```
 */
export async function withBatch<T extends readonly any[]>(
  db: DrizzleClient,
  queries: [...T]
): Promise<any[]> {
  return await db.batch(queries as any);
}

/**
 * Legacy compatibility function for old code that uses withBatch with a callback.
 * Converts callback-style to array-style batch execution.
 *
 * @deprecated Migrate to direct db.batch() calls with query arrays
 */
export interface BatchBuilder {
  queries: any[];
  add(query: any): void;
}

export async function withBatchCallback(
  db: DrizzleClient,
  fn: (batch: BatchBuilder) => void | Promise<void>
): Promise<any[]> {
  const batch: BatchBuilder = {
    queries: [],
    add(query: any) {
      this.queries.push(query);
    },
  };

  await fn(batch);

  if (batch.queries.length === 0) {
    return [];
  }

  return await db.batch(batch.queries as any);
}

/**
 * Note: Drizzle does not support nested transactions.
 * Keep operations flat and use batch() for atomic multi-statement operations.
 */
