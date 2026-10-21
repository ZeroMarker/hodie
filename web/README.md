# web

Hodie 的 Next.js 应用,架构见 [架构设计](../docs/architecture.md)。

```bash
pnpm install
export DATABASE_URL="$(avn service get mammoth --format '{service_uri}' | sed 's#/defaultdb?#/hodie_dev?#')"
pnpm db:migrate     # 把 db/migrations 应用到 app schema
pnpm dev            # http://localhost:3000;登录链接打印在终端里
pnpm typecheck && pnpm lint && pnpm test
```

- `db/vocab-schema.ts`:`vocab` schema 的只读定义,和 `scripts/vocab/build.py` 的建表语句保持一致。
- `db/app-schema.ts`:`app` schema;改动后运行 `pnpm db:generate` 生成迁移,迁移文件入库。
- `pnpm check-refs`:导入词库后检查 `app.cards` 是否引用了已不存在的词或词义,有则退出码为 1。
- 数据库连接:`db/index.ts` 是进程内连接池(`DB_POOL_MAX`,默认 3),`db/connection.ts` 处理 Aiven CA 证书,见 [架构设计](../docs/architecture.md) 的「连接」一节。
- 登录:`modules/auth`(Auth.js v5,数据库会话)。环境变量 `AUTH_SECRET`(必需,本地写在 `.env.local`)、`AUTH_RESEND_KEY` 和 `AUTH_EMAIL_FROM`(邮箱登录;本地不设时链接打印到终端,生产不设则无法发信)、`AUTH_GOOGLE_ID` 和 `AUTH_GOOGLE_SECRET`(设了才显示 Google 登录,回调地址为 `/api/auth/callback/google`)。读会话用 `modules/auth` 导出的 `auth()`,它先调用 `connection()`,否则 Cache Components 会报错。
- 学习:`modules/study`。纯函数(`grade`、`schedule`、`interference`、`meaning`、`forms`、`day`、`placement-rules`)有单元测试;`queue.ts` 组当日队列,`submit.ts` 在一个事务里重放作答并更新 `cards`、`review_logs`、`daily_stats`。学习日按北京时间凌晨 4 点切换。
- 样式:只做浅色主题,`app/globals.css` 设 `color-scheme: light`;不要在 Tailwind 层外写 `body` 颜色,否则会覆盖页面上的文字颜色类。
- 部署:Vercel 项目 `hodie`(`vercel.json` 定区域 bom1),推送 main 自动部署生产;`DATABASE_URL` 在 Vercel 里配置,生产为 `hodie`、预览为 `hodie_dev`。改了 `app` schema 要先对两个库各跑一次 `pnpm db:migrate` 再推送。
- 开发用 `hodie_dev` 库(含 `vocab` 和 `app`),线上用 `hodie` 库;连接串不要写进仓库或 `.env` 以外的文件。
