/**
 * Idempotency Protection
 *
 * Prevents duplicate execution of critical operations using KV storage.
 * Useful for preventing race conditions in user registration, OAuth callbacks,
 * and other operations that should only happen once per unique request.
 */

export interface IdempotencyOptions {
  /**
   * Time-to-live for the idempotency key in seconds.
   * Default: 60 seconds (1 minute)
   */
  ttlSeconds?: number;

  /**
   * Time-to-live for successful operation results in seconds.
   * Default: 86400 seconds (24 hours)
   */
  successTtlSeconds?: number;
}

export interface IdempotencyResult<T> {
  /**
   * Whether this is a duplicate request (key already existed)
   */
  isDuplicate: boolean;

  /**
   * The result of the operation (from cache if duplicate)
   */
  result?: T;
}

/**
 * Executes a function with idempotency protection.
 * If the same key is used concurrently or recently, prevents duplicate execution.
 *
 * @param kv - KV namespace for storing idempotency keys
 * @param key - Unique identifier for this operation
 * @param fn - Function to execute (only runs if key is new)
 * @param options - Configuration options
 * @returns Result with isDuplicate flag and operation result
 *
 * @example
 * ```typescript
 * const { isDuplicate, result } = await withIdempotency(
 *   env.IDEMPOTENCY_KEYS,
 *   `register:${email}`,
 *   async () => {
 *     return await userService.register(email, password);
 *   }
 * );
 *
 * if (isDuplicate) {
 *   return c.json({ Success: false, Message: "Duplicate request" }, 409);
 * }
 * ```
 */
export async function withIdempotency<T>(
  kv: KVNamespace,
  key: string,
  fn: () => Promise<T>,
  options: IdempotencyOptions = {}
): Promise<IdempotencyResult<T>> {
  const { ttlSeconds = 60, successTtlSeconds = 86400 } = options;
  const idempotencyKey = `idempotency:${key}`;

  // Check if operation already exists
  const existing = await kv.get(idempotencyKey, 'json');
  if (existing !== null) {
    // If operation completed successfully, return cached result
    if (typeof existing === 'object' && existing !== null && 'status' in existing) {
      const cached = existing as { status: string; result?: T };
      if (cached.status === 'completed' && cached.result !== undefined) {
        return { isDuplicate: true, result: cached.result };
      }
    }

    // If operation is still processing, reject as duplicate
    return { isDuplicate: true };
  }

  // Mark operation as processing
  await kv.put(idempotencyKey, JSON.stringify({ status: 'processing', timestamp: Date.now() }), {
    expirationTtl: ttlSeconds,
  });

  try {
    // Execute the operation
    const result = await fn();

    // Store successful result with longer TTL
    await kv.put(
      idempotencyKey,
      JSON.stringify({ status: 'completed', result, timestamp: Date.now() }),
      { expirationTtl: successTtlSeconds }
    );

    return { isDuplicate: false, result };
  } catch (error) {
    // Delete the key on failure to allow retry
    await kv.delete(idempotencyKey);
    throw error;
  }
}

/**
 * Simpler idempotency check that just prevents duplicates without caching results.
 * Useful when you just need to prevent concurrent execution.
 *
 * @param kv - KV namespace for storing idempotency keys
 * @param key - Unique identifier for this operation
 * @param fn - Function to execute (only runs if key is new)
 * @param ttlSeconds - How long to hold the lock (default: 60)
 * @throws Error if duplicate request detected
 *
 * @example
 * ```typescript
 * await withIdempotencyCheck(
 *   env.IDEMPOTENCY_KEYS,
 *   `oauth:apple:${providerId}`,
 *   async () => {
 *     return await oauthService.linkProvider(userId, providerId);
 *   }
 * );
 * ```
 */
export async function withIdempotencyCheck<T>(
  kv: KVNamespace,
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 60
): Promise<T> {
  const idempotencyKey = `idempotency:${key}`;

  // Check if operation already in progress
  const existing = await kv.get(idempotencyKey);
  if (existing !== null) {
    throw new Error('Duplicate request detected - operation already in progress');
  }

  // Mark operation as in progress
  await kv.put(idempotencyKey, 'processing', { expirationTtl: ttlSeconds });

  try {
    // Execute the operation
    const result = await fn();

    // Delete the key on success to allow future operations
    await kv.delete(idempotencyKey);

    return result;
  } catch (error) {
    // Delete the key on failure to allow retry
    await kv.delete(idempotencyKey);
    throw error;
  }
}
