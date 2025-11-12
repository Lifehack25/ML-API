import { validator } from "hono/validator";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiError } from "./responses";

type JsonValidatorOptions = {
  status?: ContentfulStatusCode;
  message?: string;
};

// Helper for validating request body without Hono middleware
export async function validateBody<Schema extends z.ZodTypeAny>(
  c: Context,
  schema: Schema
): Promise<{ success: true; data: z.infer<Schema> } | { success: false; response: Response }> {
  try {
    const body = await c.req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.message ?? "Invalid request body";
      return {
        success: false,
        response: c.json({ error: message, details: parsed.error.issues } as ApiError, 400),
      };
    }

    return {
      success: true,
      data: parsed.data,
    };
  } catch {
    return {
      success: false,
      response: c.json({ error: "Invalid JSON in request body" } as ApiError, 400),
    };
  }
}

export const validateJson = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  options?: JsonValidatorOptions
) =>
  validator("json", (body, c) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = options?.message ?? issue?.message ?? "Invalid request body";
      return c.json({ error: message, details: parsed.error.issues } as ApiError, options?.status ?? 400);
    }
    return parsed.data;
  });

type NumericParamOptions = {
  message?: string;
  status?: ContentfulStatusCode;
  min?: number;
  max?: number;
};

export const requireNumericParam = (name: string, options?: NumericParamOptions) =>
  validator("param", (params, c) => {
    const rawValue = params[name];
    if (rawValue === undefined) {
      return c.json({ error: options?.message ?? `Missing ${name}` } as ApiError, options?.status ?? 400);
    }

    const value = Number(rawValue);
    const min = options?.min;
    const max = options?.max;

    if (!Number.isFinite(value)) {
      return c.json({ error: options?.message ?? `Invalid ${name}` } as ApiError, options?.status ?? 400);
    }
    if (min !== undefined && value < min) {
      return c.json({ error: options?.message ?? `Invalid ${name}` } as ApiError, options?.status ?? 400);
    }
    if (max !== undefined && value > max) {
      return c.json({ error: options?.message ?? `Invalid ${name}` } as ApiError, options?.status ?? 400);
    }

    return {
      ...params,
      [name]: value,
    };
  });

type BooleanQueryOptions = {
  message?: string;
  status?: ContentfulStatusCode;
  defaultValue?: boolean;
};

export const booleanQuery = (name: string, options?: BooleanQueryOptions) =>
  validator("query", (query, c) => {
    const rawValue = query[name];
    if (rawValue === undefined) {
      return {
        ...query,
        [name]: options?.defaultValue ?? false,
      };
    }

    if (rawValue === "true" || rawValue === "false") {
      return {
        ...query,
        [name]: rawValue === "true",
      };
    }

    return c.json({ error: options?.message ?? `Invalid ${name}` } as ApiError, options?.status ?? 400);
  });
