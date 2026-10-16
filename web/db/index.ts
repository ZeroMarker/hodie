import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Aiven 免费版没有 PgBouncer 连接池,上限约 20 个连接:每个实例只开 1 个连接。
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL!, { max: 1, idle_timeout: 20, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql);
