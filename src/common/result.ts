export interface ServiceSuccess<T> {
  ok: true;
  data: T;
  message?: string;
  status?: number;
}

export interface ServiceErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ServiceFailure {
  ok: false;
  error: ServiceErrorDetail;
  status?: number;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

export const success = <T>(
  data: T,
  message?: string,
  status?: number
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
  status?: number
): ServiceFailure => ({
  ok: false,
  error: { code, message, details },
  status,
});

