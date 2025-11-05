import { validator } from "hono/validator";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { fail } from "./responses";

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
        response: fail(c, message, 400, parsed.error.issues),
      };
    }

    return {
      success: true,
      data: parsed.data,
    };
  } catch {
    return {
      success: false,
      response: fail(c, "Invalid JSON in request body", 400, null),
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
      return fail(c, message, options?.status ?? 400, parsed.error.issues);
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
      return fail(c, options?.message ?? `Missing ${name}`, options?.status ?? 400, null);
    }

    const value = Number(rawValue);
    const min = options?.min;
    const max = options?.max;

    if (!Number.isFinite(value)) {
      return fail(c, options?.message ?? `Invalid ${name}`, options?.status ?? 400, null);
    }
    if (min !== undefined && value < min) {
      return fail(
        c,
        options?.message ?? `Invalid ${name}`,
        options?.status ?? 400,
        null
      );
    }
    if (max !== undefined && value > max) {
      return fail(
        c,
        options?.message ?? `Invalid ${name}`,
        options?.status ?? 400,
        null
      );
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

    return fail(c, options?.message ?? `Invalid ${name}`, options?.status ?? 400, null);
  });
