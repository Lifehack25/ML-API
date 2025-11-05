import type { Context } from "hono";
import { DomainError } from "../../business/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const handleError = (err: unknown, c: Context) => {
  if (err instanceof DomainError) {
    return c.json(
      {
        Success: false,
        Message: err.message,
        Code: err.code,
        Data: err.details ?? null,
      },
      err.status as ContentfulStatusCode
    );
  }

  console.error("Unhandled error:", err);
  return c.json(
    {
      Success: false,
      Message: "Internal server error",
    },
    500 as ContentfulStatusCode
  );
};
