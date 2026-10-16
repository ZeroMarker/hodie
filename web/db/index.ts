import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { connectionConfig } from "./connection";

// Aiven 免费版没有 PgBouncer,整个服务约 20 个连接:在进程内用 pg.Pool 复用连接。
// Vercel Fluid compute 下一个实例会并发处理多个请求,共享这个池;
// attachDatabasePool 让实例在挂起前先关掉空闲连接,避免连接泄漏。
// 每个实例的连接数由 DB_POOL_MAX 控制(默认 3),实例数 × DB_POOL_MAX 要留在上限以内。
const globalForDb = globalThis as unknown as { pool?: Pool };

function createPool() {
  const pool = new Pool({
    ...connectionConfig(),
    max: Number(process.env.DB_POOL_MAX ?? 3),
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  // 空闲连接被服务端断开时 pg 会发 error 事件,不处理会让进程崩溃
  pool.on("error", (err) => console.error("pg pool error", err));
  attachDatabasePool(pool);
  return pool;
}

export const pool = globalForDb.pool ?? createPool();
// 开发时热更新会重新执行本模块,复用同一个池
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool);
