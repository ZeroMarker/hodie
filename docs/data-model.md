# 数据模型

2026-11-25

数据库分两个 schema:`vocab` 是只读词库,每次重建整体替换;`app` 是用户数据,只做增量迁移。本文给概念模型和稳定键,字段细节见 [scripts/vocab](../scripts/vocab/README.md) 和 [架构设计](architecture.md)。

## vocab schema

十二张表,由 `scripts/vocab/build.py` 生成,`load_pg.py` 导入。

| 表 | 内容 |
| --- | --- |
| `words` | 词条、音标、中英释义、词性、词形变化、CEFR、词频、NGSL 排名、是否具体名词、核心义词义 `core_sense_id` |
| `word_lists` | 词书归属,`list` 取 `zk`、`gk`、`cet4`、`cet6`、`ky`、`ielts`、`toefl`、`gre`、`ngsl` |
| `senses` | Open English WordNet 词义,含英文释义、例句、语域和语义类别 |
| `relations` | 词义间关系:同义、反义、上位、下位、相似、派生、相关 |
| `languages` | 词源语言代码和名称 |
| `etymologies` | Wiktionary 词源说明,一词可有多个词源(`etym_no`) |
| `etymology_steps` | 结构化的来源链,如 respect ← 中古英语 respect ← 古法语 respect ← 拉丁语 respectus |
| `morphemes` / `word_morphemes` | 构词拆分,如 inspect = in- + -spect,以及词缀的原义和来源语言 |
| `collocations` | Tatoeba 统计的搭配,加上 AI 为缺口补的搭配;AI 行的 `freq` 和 `log_dice` 为空 |
| `examples` | Tatoeba 中英例句,加上 AI 为缺口补的例句;带 `source`、`license`、`reviewed` |
| `etymology_notes` | AI 生成并审核的中文词源讲解,一词一条,不超过 120 字 |

关键约定:

- `words.id` 由 `scripts/vocab/word_ids.tsv` 登记,重建时保持不变,新词追加;这是 `app.cards` 引用词条的稳定键。
- `senses.id` 是 WordNet sense key,同一版 OEWN 内不变。
- `examples`、`collocations` 等表的自增 id 每次重建都可能变,`app` 里不保存这些 id。
- AI 生成的行 `source` 写 `ai:opencode/<model>`,并带 `reviewed`;查询时优先取 `reviewed = 1` 的数据,缺少可用内容时才回退到 `reviewed = 0`(例如某词没有已审核的例句)。
- `app` 不对 `vocab` 建外键:`load_pg.py` 替换 schema 时外键会被一并删掉,引用一致性由导入后的 `web/scripts/check-refs.mts` 检查。

## app schema

十三张表,定义在 `web/db/app-schema.ts`,迁移在 `web/db/migrations/`。

| 分组 | 表 | 说明 |
| --- | --- | --- |
| 认证 | `users`、`accounts`、`sessions`、`verification_tokens` | Auth.js 标准表;只有这几张表之间建外键 |
| 用户设置 | `profiles`、`placement` | 词书、每日新词数、目标保持率、FSRS 参数、自适应状态;词汇量测试结果 |
| 学习 | `cards`、`review_logs`、`daily_stats` | 一张卡片 = 用户 × 词条 × 词义;作答只追加,客户端 UUID 用于离线去重;每日统计供打卡和自适应使用 |
| AI(阶段 3) | `conversations`、`messages`、`ai_usage`、`ai_cache` | 对话历史、按用户/日期/功能的用量、请求哈希缓存;表已建,功能未接入 |

`profiles`、`cards`、`review_logs` 等表的 `user_id` 在逻辑上引用 `users.id`,但不建外键,便于账号删除时逐表清理。字段和索引见 [架构设计](architecture.md) 的「app schema」。

## 历史说明

初版设计用一张 `user_word_state` 保存 SRS 状态,`examples` 直接带音频 URL。实际实现改为 `cards` + `review_logs`,音频由浏览器朗读,不再存 URL。旧文档中的 `user_word_state` 和「例句音频 URL」已废弃,不要按旧名称建表。

返回 [开发计划](plan.md)。
