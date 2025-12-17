import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/data/schema/*",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
