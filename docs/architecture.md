# 架构设计

2026-10-16

词库已经建好并导入 Aiven PostgreSQL 的 `vocab` schema(见 [scripts/vocab](../scripts/vocab/README.md)),应用端还没有代码。本文定下应用端的整体架构:一个 Next.js 应用加一个 PostgreSQL 库,不拆服务。学习规则见 [单词学习方案](word-learning-plan.md),表的概念模型见 [数据模型](data-model.md)。

## 总览

浏览器端负责展示和离线作答,服务端负责调度、计分和 AI 调用,数据库分成只读的词库和可写的用户数据两部分。

```
浏览器(PWA)
  ├─ React 页面:学习、复习、词卡、图谱、对话
  ├─ Service Worker:静态资源和当日队列缓存
  └─ IndexedDB:离线作答记录(待同步)
        │ HTTPS(Server Actions / Route Handlers)
Next.js 应用(Vercel)
  ├─ auth      登录、会话
  ├─ study     队列生成、作答、FSRS 调度、自适应
  ├─ vocab     词卡、关系、词源查询(只读)
  ├─ ai        对话、造句批改、短故事;限额和缓存
  └─ tts       发音(先浏览器 TTS,后云端 TTS + 对象存储)
        │ 进程内连接池 pg.Pool(免费版无 PgBouncer)
PostgreSQL(Aiven mammoth / hodie 库)
  ├─ vocab schema:词库,只读,由 load_pg.py 整体替换
  └─ app schema:用户、卡片、作答记录、对话,由迁移工具管理
```

## 技术选型

在 [开发计划](plan.md) 的选型上,把「二选一」的项都定下来。

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | Next.js(App Router)+ TypeScript + Tailwind | 页面和 API 同一个项目 |
| 包管理 | pnpm | 锁文件入库 |
| 数据库 | Aiven PostgreSQL `hodie` 库 | 已在用;不再考虑 Supabase |
| ORM 与迁移 | Drizzle ORM + drizzle-kit | 只管 `app` schema;`vocab` 用 introspect 生成只读类型 |
| 认证 | Auth.js(邮箱魔法链接 + Google) | 会话存 `app` schema;邮件用 Resend |
| 调度 | ts-fsrs | 只在服务端运行,保证状态一致 |
| 离线 | Serwist(Service Worker)+ IndexedDB | 阶段 2 实现 |
| 图谱 | Cytoscape.js | 阶段 2 实现 |
| AI | Claude API(`claude-sonnet-5-5` 对话,`claude-haiku-5-5` 批改和短任务) | 只在服务端调用 |
| 部署 | Vercel(区域 bom1 孟买,靠近 Aiven do-blr) | 预览环境连独立的 `hodie_dev` 库 |
| 测试 | Vitest(单元)+ Playwright(端到端) | 调度和计分规则必须有单元测试 |

## 代码结构

应用放在仓库根目录的 `web/`,与 `scripts/` 并列;按业务模块划分,不按技术层划分。

```
web/
  app/                 页面与路由(study、review、word/[id]、graph、chat、settings)
  modules/
    auth/
    study/             queue.ts、grade.ts、schedule.ts、adapt.ts
    vocab/             card.ts、relations.ts、etymology.ts
    ai/                client.ts、quota.ts、prompts/
    tts/
  db/
    app-schema.ts      app schema 的 Drizzle 定义
    vocab-schema.ts    vocab schema 的只读定义(introspect 生成)
    migrations/
  tests/
```

规则:

- 页面只调用 `modules/*` 导出的函数,不直接写 SQL。
- `study` 里的计分、调度、自适应写成纯函数(输入状态和作答,输出新状态),便于测试和后续离线重放。
- 模块之间只通过导出函数互相调用,`vocab` 不依赖其他模块。

## 数据库

两个 schema 的生命周期不同:`vocab` 每次重建整体替换,`app` 只能增量迁移。

### vocab schema

- 由 `scripts/vocab/load_pg.py` 先导入 `vocab_new`,再在一个事务里替换,线上不中断。
- 应用只读;数据库给应用用的角色只授予 `vocab` 的 SELECT 权限。
- 稳定的键:`words.id`(由 `word_ids.tsv` 保证)和 `senses.id`(WordNet sense key,同一版 OEWN 内不变)。`examples`、`collocations` 等表的自增 id 每次重建都可能变,`app` 里不保存这些 id。

### app schema

`app` 表不对 `vocab` 建外键:`load_pg.py` 用 `DROP SCHEMA ... CASCADE` 替换词库,外键会被一并删掉。引用一致性改由导入后的检查脚本保证(查找 `app.cards` 中 `word_id` 或 `sense_id` 已不存在的行)。

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| `users` 等 | Auth.js 标准表 | 账号、会话、验证令牌 |
| `profiles` | user_id、词书、每日新词数、目标保持率、FSRS 参数 | 偏好和自适应状态 |
| `placement` | user_id、档位、结果 | 词汇量测试结果 |
| `cards` | id、user_id、word_id、sense_id、level(L0–L4)、FSRS 状态(due、stability、difficulty、reps、lapses、state、last_review)、suspended | 一张卡片 = 用户 × 词条 × 词义;唯一键 (user_id, word_id, sense_id) |
| `review_logs` | id(客户端生成的 UUID)、card_id、题型、级别、评分、耗时、用户答案、作答时间、作答前后 S 和 D、上次间隔 | 只追加;UUID 用于离线同步去重 |
| `daily_stats` | user_id、日期、新学数、复习数、正确率、用时 | 打卡、统计和自适应的输入 |
| `conversations` / `messages` | 场景、难度、消息、纠错结果 | AI 对话历史 |
| `ai_usage` | user_id、日期、功能、输入输出 token 数 | 限额和成本统计 |
| `ai_cache` | 请求哈希、结果、模型、创建时间 | 相同请求复用结果 |

`cards (user_id, due)` 建索引,用于取到期卡片。

### 连接

`mammoth` 是 Aiven 免费版(do-blr,班加罗尔,PostgreSQL 18),不提供 PgBouncer 连接池(创建时返回 403),连接数上限约 20。因此连接池在代码里实现(`web/db/index.ts`):

- 每个函数实例一个 `pg.Pool`,上限 `DB_POOL_MAX`(默认 3),空闲 5 秒关闭连接。Vercel Fluid compute 下一个实例并发处理多个请求,共享这个池。
- 用 `@vercel/functions` 的 `attachDatabasePool` 注册连接池,实例挂起前先关闭空闲连接,避免连接泄漏。
- 实例数 × `DB_POOL_MAX` 加上迁移和脚本的连接,要留在 20 以内;内测并发上来后升级付费版,改走 transaction 模式的 PgBouncer。
- Aiven 证书由项目 CA 签发,CA 证书(非机密)入库在 `web/db/aiven-ca.pem`,`web/db/connection.ts` 用它校验服务器证书,并去掉连接串里的 `sslmode`(否则 pg 会改用系统信任链而失败)。

连接串放在 Vercel 环境变量里,本地开发用 `avn service get mammoth --format '{service_uri}'` 现取,不写进仓库。

## 学习流程的数据流

一次学习会话分三步,作答可以批量提交。

1. **取队列**:`study.getQueue(user)` 按 [单词学习方案](word-learning-plan.md) 的顺序组出当日队列:到期卡片(上限 100)、新词(按词书和 `freq_rank`,做干扰控制)。返回卡片内容、题型和干扰项,客户端一次拿全。
2. **作答**:客户端判断对错、记录耗时,把作答写进 IndexedDB,再批量提交。离线时只写本地,联网后补交。
3. **提交**:`study.submit(logs)` 按 `review_logs.id` 去重,按作答时间顺序重放:计分(`grade`)→ FSRS 调度(`schedule`)→ 更新 `cards` 和 `daily_stats`,在一个事务里完成。服务端结果为准,客户端拿到新状态后覆盖本地。

客户端判对错只用于即时反馈;评分(Again、Hard、Good、Easy)在服务端按耗时中位数等规则重算,避免篡改。

## AI 调用

AI 功能分两类:离线批量生成的词库数据已在 `vocab` 中(见 [阶段 3 词库任务](stage3-vocab-tasks.md)),应用运行时只做和用户输入有关的调用。

| 功能 | 模型 | 输入 | 防护 |
| --- | --- | --- | --- |
| 口语对话 | Sonnet | 场景、难度、历史消息 | 每次对话最多 20 轮,历史超过 10 轮时截断 |
| 造句批改(L4) | Haiku | 目标词、核心义、用户句子 | 结构化输出(对错、问题、改写) |
| 语境短故事 | Haiku | 当日和近 3 天的词 | 按词集合哈希缓存 |
| 词源讲解 | 不调用 | 用 `etymology_notes` | 不在运行时生成,避免编造 |

所有调用经过 `ai.client`:先查 `ai_cache`,再检查 `ai_usage` 当日限额,调用后记录 token 数。提示词放在 `modules/ai/prompts/`,带版本号,与 `vocab-ai/*/PROMPT.md` 的做法一致。

## 发音

- 阶段 1:浏览器 Web Speech API,无成本;不支持的浏览器隐藏发音按钮。
- 阶段 2:云端 TTS 为单词和例句生成音频,存到对象存储(Cloudflare R2),文件名用文本哈希;按词书词频从高到低预生成,其余按需生成后缓存。

## 环境与发布

| 环境 | 数据库 | 用途 |
| --- | --- | --- |
| 本地 | `hodie_dev` 库 | 开发,可随意重置 `app` schema |
| 预览 | `hodie_dev` 库 | 每次推送 main 后 Vercel 自动部署,用于验收 |
| 生产 | `hodie` 库 | 内测和发布 |

- CI(GitHub Actions,`.github/workflows/web.yml`):类型检查、lint、单元测试、构建。接入 Vercel 后,再在部署前由 CI 执行 `drizzle-kit migrate`。
- 词库更新:先对 `hodie_dev` 运行 `load_pg.py` 和 `pnpm check-refs`,通过后再导入 `hodie`。

## 安全与隐私

- 所有用户数据查询都带 `user_id` 条件,由 `modules/*` 统一从会话中取,不接受客户端传入。
- Claude API 密钥只在服务端;对话内容不用于其他用途,支持用户删除。
- 阶段 4 提供数据导出(JSON)和账号删除(删除 `app` 中该用户的全部行)。
- wordfreq 数据禁止转成 CSV 分发,应用不提供词表批量导出接口。

## 待定

- [ ] 生产环境是否需要和 `hodie` 分开的 Aiven 服务(目前词库和用户数据共用 `mammoth`);连接数和付费版一起决定。
- [ ] 用户在中国大陆,Vercel 和 Aiven 班加罗尔都可能较慢;内测前从国内实测首屏和接口延迟,不达标再考虑香港或新加坡区域。
- [ ] 云端 TTS 供应商,在阶段 2 开始前比价。

返回 [开发计划](plan.md)。
