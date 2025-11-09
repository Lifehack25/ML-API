/**
 * D1 Transaction Utilities
 *
 * Provides atomic multi-statement operations for Cloudflare D1 using the batch API.
 * D1 does NOT support explicit BEGIN/COMMIT/ROLLBACK SQL statements in Workers.
 * Instead, use the batch API for true ACID transaction semantics.
 *
 * @example Using batch API (preferred for known statements):
 * ```typescript
 * await withBatch(db, (batch) => {
 *   batch.add("DELETE FROM media_objects WHERE id = ?", mediaId);
 *   batch.add("UPDATE locks SET album_title = ? WHERE id = ?", title, lockId);
 * });
 * // All statements succeed or all fail (atomic)
 * ```
 *
 * @example Using withTransaction (legacy compatibility, no atomicity):
 * ```typescript
 * await withTransaction(db, async (tx) => {
 *   await tx.prepare("INSERT INTO users ...").run();
 *   await tx.prepare("UPDATE locks ...").run();
 *   // WARNING: Not atomic! Use withBatch instead for atomicity.
 * });
 * ```
 */

export interface TransactionContext {
  db: D1Database;
  isInTransaction: boolean;
}

/**
 * Batch statement builder for atomic multi-statement operations.
 * Collects SQL statements and executes them atomically via D1's batch API.
 */
export class BatchBuilder {
  private statements: D1PreparedStatement[] = [];

  constructor(private db: D1Database) {}

  /**
   * Adds a prepared statement to the batch.
   *
   * @param sql - SQL query string
   * @param params - Query parameters (will be bound in order)
   * @returns this for method chaining
   */
  add(sql: string, ...params: unknown[]): this {
    let stmt = this.db.prepare(sql);
    if (params.length > 0) {
      stmt = stmt.bind(...params);
    }
    this.statements.push(stmt);
    return this;
  }

  /**
   * Adds a pre-prepared D1 statement to the batch.
   *
   * @param statement - Pre-prepared D1PreparedStatement
   * @returns this for method chaining
   */
  addStatement(statement: D1PreparedStatement): this {
    this.statements.push(statement);
    return this;
  }

  /**
   * Executes all statements atomically.
   * All statements succeed or all fail together.
   *
   * @returns Array of D1Result objects, one per statement
   * @throws Error if any statement fails (all rolled back)
   */
  async execute(): Promise<D1Result[]> {
    if (this.statements.length === 0) {
      return [];
    }

    const results = await this.db.batch(this.statements);

    // Check for failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.success) {
        throw new Error(
          `Batch transaction failed at statement ${i + 1}/${results.length}: ${result.error || 'Unknown error'}`
        );
      }
    }

    return results;
  }

  /**
   * Returns the number of statements in the batch.
   */
  get count(): number {
    return this.statements.length;
  }
}

/**
 * Executes multiple SQL statements atomically using D1's batch API.
 * All statements succeed together or all fail together (true ACID semantics).
 *
 * @param db - D1 database instance
 * @param fn - Function that adds statements to the batch builder
 * @returns Array of D1Result objects
 * @throws Error if any statement fails (automatic rollback)
 *
 * @example
 * ```typescript
 * const results = await withBatch(db, (batch) => {
 *   batch.add("DELETE FROM media_objects WHERE id = ?", mediaId);
 *   batch.add("UPDATE media_objects SET display_order = ? WHERE id = ?", newOrder, mediaId);
 *   batch.add("UPDATE locks SET album_title = ? WHERE id = ?", title, lockId);
 * });
 * // All succeed or all fail atomically
 * ```
 */
export async function withBatch(
  db: D1Database,
  fn: (batch: BatchBuilder) => void | Promise<void>
): Promise<D1Result[]> {
  const batch = new BatchBuilder(db);
  await fn(batch);
  return batch.execute();
}

/**
 * Legacy transaction wrapper for backwards compatibility.
 *
 * WARNING: This does NOT provide true transaction semantics.
 * Individual statements are atomic, but multiple statements are NOT rolled back together.
 * Use withBatch() instead for true atomic multi-statement operations.
 *
 * @deprecated Use withBatch() for atomic operations
 * @param db - D1 database instance
 * @param fn - Async function to execute
 * @returns Result of the function
 * @throws Error from fn (no automatic rollback)
 */
export async function withTransaction<T>(
  db: D1Database,
  fn: (tx: D1Database) => Promise<T>
): Promise<T> {
  // Detect nested transactions (not supported)
  const isInTransaction = (db as any).__inTransaction === true;
  if (isInTransaction) {
    throw new Error("Nested transactions are not supported. Pass the transaction DB instance to child operations.");
  }

  // Mark DB instance to detect nesting
  const txDb = Object.create(db);
  (txDb as any).__inTransaction = true;

  try {
    // Execute function - each statement is atomic but not collectively transactional
    const result = await fn(txDb);
    return result;
  } catch (error) {
    // No rollback possible - error is thrown as-is
    // Calling code should handle partial failure scenarios
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
