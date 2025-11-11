import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";

/**
 * Creates a Drizzle database client instance from a D1Database binding
 * @param d1 - The D1Database instance from Cloudflare Workers binding
 * @returns A Drizzle database client with type-safe query methods
 */
export function createDrizzleClient(d1: D1Database) {
  return drizzle(d1, { schema });
}

/**
 * Type representing a Drizzle database client instance
 */
export type DrizzleClient = ReturnType<typeof createDrizzleClient>;
