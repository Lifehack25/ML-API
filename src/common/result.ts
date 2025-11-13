import type { StatusCode } from "hono/utils/http-status";

export interface ServiceSuccess<T> {
  ok: true;
  data: T;
  message?: string;
  status?: StatusCode;
}

export interface ServiceErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ServiceFailure {
  ok: false;
  error: ServiceErrorDetail;
  status?: StatusCode;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export const success = <T>(
  data: T,
  message?: string,
  status?: StatusCode
): ServiceSuccess<T> => ({
  ok: true,
  data,
  message,
  status,
});

export const failure = (
  code: string,
  message: string,
  details?: unknown,
  status?: StatusCode
): ServiceFailure => ({
  ok: false,
  error: { code, message, details },
  status,
});

