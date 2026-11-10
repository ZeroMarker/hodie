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
- 学习:`modules/study`。纯函数(`grade`、`schedule`、`interference`、`meaning`、`forms`、`day`、`placement-rules`)有单元测试;`queue.ts` 组当日队列(L1、L3 约三分之一换成听音选义、听写;例句用 `clozeFor` 避开同形异义词形),`adapt.ts` 每个学习日第一次读设置时做自适应(规则在 `adapt-rules.ts`,纯函数);`mistakes.ts` 查错题本(近 30 天评分为 Again 的卡片),`getPracticeQueue` 组错题练习(不提交);leech(遗忘 ≥ 4 次)卡片在重学阶段先看词卡。`submit.ts` 在一个事务里重放作答并批量更新 `cards`、`review_logs`、`daily_stats`(一批固定 5 次查询)。学习日按北京时间凌晨 4 点切换。
- 词卡页:`modules/vocab/relations.ts`(同族、近反义、上位词、词素)、`etymology.ts`(词源链)、`graph.ts`(图谱节点和边),都用 `"use cache"` 缓存一天;`components/word-graph.tsx` 在浏览器里动态加载 Cytoscape.js 画图,掌握状态由 `modules/study/stats.ts` 的 `wordStatus` 提供。
- 离线:`public/sw.js` 是手写的 service worker(只在生产环境由 `components/pwa.tsx` 注册,开发时不注册);`modules/offline/pending.ts` 管本地待提交的作答;`NavLink` 离线时改成整页跳转,让 service worker 返回缓存页面。改了 `sw.js` 的缓存策略要同时改缓存名(如 `hodie-static-v2`),旧缓存在 activate 时删除。
- 样式:只做浅色主题,`app/globals.css` 设 `color-scheme: light`;不要在 Tailwind 层外写 `body` 颜色,否则会覆盖页面上的文字颜色类。
- 部署:Vercel 项目 `hodie`(`vercel.json` 定区域 bom1),推送 main 自动部署生产;`DATABASE_URL` 在 Vercel 里配置,生产为 `hodie`、预览为 `hodie_dev`。改了 `app` schema 要先对两个库各跑一次 `pnpm db:migrate` 再推送。
- 开发用 `hodie_dev` 库(含 `vocab` 和 `app`),线上用 `hodie` 库;连接串不要写进仓库或 `.env` 以外的文件。
