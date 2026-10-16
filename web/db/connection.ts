import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolConfig } from "pg";

// Aiven 的服务器证书由项目自己的 CA 签发,不在系统信任链里。
// CA 证书不是机密,入库在 db/aiven-ca.pem;也可用 DATABASE_CA 环境变量(PEM 文本)覆盖。
// 连接串里的 sslmode 会被 pg 解析成另一套 TLS 配置并覆盖这里,所以先去掉。
export function connectionConfig(url = process.env.DATABASE_URL): PoolConfig {
  if (!url) throw new Error("DATABASE_URL 未设置");
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  const ca =
    process.env.DATABASE_CA ?? readFileSync(join(process.cwd(), "db", "aiven-ca.pem"), "utf8");
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
