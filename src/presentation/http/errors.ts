import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError } from "./responses";

export const handleError = (err: unknown, c: Context) => {
  console.error("Unhandled error:", err);

  // Extract error details for better debugging
  const errorMessage = err instanceof Error ? err.message : "Internal server error";

  const response: ApiError = {
    error: errorMessage,
    code: "INTERNAL_ERROR",
  };

  return c.json(response, 500 as ContentfulStatusCode);
};
