import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Standardized result pattern for service operations.
 * Avoids throwing errors for expected business logic failures.
 */
export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export interface ServiceSuccess<T> {
  ok: true;
  data: T;
  message?: string;
  status?: ContentfulStatusCode;
}

export interface ServiceErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ServiceFailure {
  ok: false;
  error: ServiceErrorDetail;
  status?: ContentfulStatusCode;
}

/**
 * Creates a successful result.
 * @param data - The data to return
 * @param message - Optional success message
 * @param status - Optional HTTP status code override
 */
export const success = <T>(
  data: T,
  message?: string,
  status?: ContentfulStatusCode
): ServiceSuccess<T> => ({
  ok: true,
  data,
  message,
  status,
});

/**
 * Creates a failed result.
 * @param code - Machine-readable error code (e.g., 'USER_NOT_FOUND')
 * @param message - Human-readable error message
 * @param details - Optional error details/payload
 * @param status - Optional HTTP status code override
 */
export const failure = (
  code: string,
  message: string,
  details?: unknown,
  status?: ContentfulStatusCode
): ServiceFailure => ({
  ok: false,
  error: { code, message, details },
  status,
});
