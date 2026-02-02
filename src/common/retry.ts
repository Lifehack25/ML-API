import { Logger } from './logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

/**
 * Executes an async function with exponential backoff retry logic.
 * Matches the behavior of ASP.NET Core's RetryHelper.ExecuteWithRetryAsync.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  logger?: Logger
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error | unknown;
  let delayMs = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxAttempts) {
        logger?.error('Retry attempts exhausted', {
          attempts: attempt,
          error: String(error),
        });
        throw error;
      }

      logger?.warn('Operation failed, retrying', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs,
        error: String(error),
      });

      await sleep(delayMs);
      delayMs = Math.min(delayMs * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
