import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/app-schema.ts",
  out: "./db/migrations",
  schemaFilter: ["app"],
  dbCredentials: { url: process.env.DATABASE_URL! },
});
