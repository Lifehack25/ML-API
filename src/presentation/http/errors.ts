import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const handleError = (err: unknown, c: Context) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      Success: false,
      Message: "Internal server error",
    },
    500 as ContentfulStatusCode
  );
};
