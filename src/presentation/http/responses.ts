import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ServiceResult } from "../../common/result";

interface Envelope<T> {
  Success: boolean;
  Message?: string;
  Data?: T;
}

export const ok = <T>(c: Context, data: T, message?: string, status: ContentfulStatusCode = 200) => {
  const body: Envelope<T> = {
    Success: true,
    Message: message,
    Data: data,
  };
  return c.json(body, status);
};

export const created = <T>(c: Context, data: T, message?: string) => ok(c, data, message, 201);

export const fail = <T>(c: Context, message: string, status: ContentfulStatusCode = 400, data?: T) => {
  const body: Envelope<T> = {
    Success: false,
    Message: message,
    Data: data,
  };
  return c.json(body, status);
};

export const respondFromService = <T>(c: Context, result: ServiceResult<T>) => {
  if (result.ok) {
    const status = (result.status ?? 200) as ContentfulStatusCode;
    return ok(c, result.data, result.message, status);
  }

  const status = (result.status ?? 400) as ContentfulStatusCode;
  return fail(c, result.error.message, status, result.error.details as T | undefined);
};
