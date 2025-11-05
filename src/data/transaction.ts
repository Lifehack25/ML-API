/**
 * D1 Transaction Wrapper
 *
 * Provides strongly consistent transaction support for Cloudflare D1 database operations.
 * Uses SQLite BEGIN IMMEDIATE/COMMIT/ROLLBACK for proper ACID guarantees.
 *
 * @example
 * ```typescript
 * await withTransaction(db, async (tx) => {
 *   await tx.prepare("INSERT INTO users ...").run();
 *   await tx.prepare("UPDATE locks ...").run();
 *   // Both committed atomically
 * });
 * ```
 */

export interface TransactionContext {
  db: D1Database;
  isInTransaction: boolean;
}

/**
 * Executes a function within a D1 database transaction.
 *
 * Automatically handles:
 * - BEGIN IMMEDIATE (acquires write lock immediately)
 * - COMMIT on success
 * - ROLLBACK on error
 * - Nested transaction detection (throws error)
 *
 * @param db - D1 database instance
 * @param fn - Async function to execute within transaction, receives transaction-aware DB instance
 * @returns Result of the function
 * @throws Error if already in transaction (nested transactions not supported)
 * @throws Error from fn (after automatic rollback)
 */
export async function withTransaction<T>(
  db: D1Database,
  fn: (tx: D1Database) => Promise<T>
): Promise<T> {
  // Detect nested transactions (not supported by D1)
  // We use a symbol property to mark transaction-aware DB instances
  const isInTransaction = (db as any).__inTransaction === true;
  if (isInTransaction) {
    throw new Error("Nested transactions are not supported. Pass the transaction DB instance to child operations.");
  }

  // Start transaction with immediate lock
  await db.prepare("BEGIN IMMEDIATE").run();

  // Mark DB instance as in-transaction to detect nesting
  const txDb = Object.create(db);
  (txDb as any).__inTransaction = true;

  try {
    // Execute function with transaction-aware DB
    const result = await fn(txDb);

    // Commit on success
    await db.prepare("COMMIT").run();

    return result;
  } catch (error) {
    // Rollback on any error
    try {
      await db.prepare("ROLLBACK").run();
    } catch (rollbackError) {
      // Log rollback failure but throw original error
      console.error("CRITICAL: Transaction rollback failed", {
        originalError: error,
        rollbackError
      });
    }

    // Re-throw original error
    throw error;
  }
}

/**
 * Checks if a D1Database instance is currently in a transaction.
 *
 * @param db - D1 database instance to check
 * @returns True if in transaction, false otherwise
 */
export function isInTransaction(db: D1Database): boolean {
  return (db as any).__inTransaction === true;
}

/**
 * Helper to execute a prepared statement with optional transaction support.
 *
 * If a transaction DB is provided, uses it. Otherwise uses the default DB.
 * This pattern allows methods to participate in external transactions or run standalone.
 *
 * @param defaultDb - Default database instance
 * @param txDb - Optional transaction database (from withTransaction)
 * @returns Database instance to use
 *
 * @example
 * ```typescript
 * class UserRepository {
 *   async create(data: CreateUserDto, txDb?: D1Database) {
 *     const db = getTransactionDb(this.db, txDb);
 *     await db.prepare("INSERT INTO users ...").run();
 *   }
 * }
 *
 * // Standalone
 * await userRepo.create(data);
 *
 * // Within transaction
 * await withTransaction(db, async (tx) => {
 *   await userRepo.create(data, tx);
 *   await lockRepo.update(lockId, tx);
 * });
 * ```
 */
export function getTransactionDb(defaultDb: D1Database, txDb?: D1Database): D1Database {
  return txDb ?? defaultDb;
}
