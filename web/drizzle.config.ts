import { defineConfig } from "drizzle-kit";
import { connectionConfig } from "./db/connection";

const { connectionString, ssl } = connectionConfig();
const u = new URL(connectionString!);

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/app-schema.ts",
  out: "./db/migrations",
  schemaFilter: ["app"],
  dbCredentials: {
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: ssl as { ca: string },
  },
});
