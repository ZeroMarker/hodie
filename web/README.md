# web

Hodie 的 Next.js 应用,架构见 [架构设计](../docs/architecture.md)。

```bash
pnpm install
export DATABASE_URL="$(avn service get mammoth --format '{service_uri}' | sed 's#/defaultdb?#/hodie_dev?#')"
pnpm db:migrate     # 把 db/migrations 应用到 app schema
pnpm dev            # http://localhost:3000/word/<words.id>
pnpm typecheck && pnpm lint && pnpm test
```

- `db/vocab-schema.ts`:`vocab` schema 的只读定义,和 `scripts/vocab/build.py` 的建表语句保持一致。
- `db/app-schema.ts`:`app` schema;改动后运行 `pnpm db:generate` 生成迁移,迁移文件入库。
- `pnpm check-refs`:导入词库后检查 `app.cards` 是否引用了已不存在的词或词义,有则退出码为 1。
- 数据库连接:`db/index.ts` 是进程内连接池(`DB_POOL_MAX`,默认 3),`db/connection.ts` 处理 Aiven CA 证书,见 [架构设计](../docs/architecture.md) 的「连接」一节。
- 部署:Vercel 项目 `hodie`(`vercel.json` 定区域 bom1),推送 main 自动部署生产;`DATABASE_URL` 在 Vercel 里配置,生产为 `hodie`、预览为 `hodie_dev`。改了 `app` schema 要先对两个库各跑一次 `pnpm db:migrate` 再推送。
- 开发用 `hodie_dev` 库(含 `vocab` 和 `app`),线上用 `hodie` 库;连接串不要写进仓库或 `.env` 以外的文件。
