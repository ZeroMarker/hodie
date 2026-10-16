# 数据模型

初版共 6 张表,以 `user_word_state` 保存 SRS 状态,`review_logs` 保存每次作答。

| 表 | 用途 |
| --- | --- |
| `users` | 账号和偏好(目标等级、每日新词量) |
| `words` | 词条、音标、释义、词频、等级 |
| `examples` | 例句,关联 `words`,含音频 URL |
| `user_word_state` | 用户对每个词的 SRS 状态(间隔、难度、下次复习时间) |
| `review_logs` | 每次作答记录,用于统计和算法调参 |
| `conversations` / `messages` | AI 对话历史 |

为支持词汇图谱,再增加以下内容:

- `senses`:词义节点,解决多义词(如 bank 的「银行」与「河岸」)。
- `relations`(src, dst, type):同义、反义、上位、下位、派生等关系。
- `morphemes`:词根词缀及其与词的关联(如 spect → inspect、respect)。
- `words` 增加 CEFR 等级和词频排名列。

为支持词源,再增加以下内容:

- `languages`:语言节点(如 Latin、Old French)。
- `relations.type` 增加 `inherited`、`borrowed_from`、`derived_from`、`semantic_shift`。
- `morphemes` 增加来源语言和原义列(如 spect 来自 Latin specere,「看」)。

为支持语域,`senses` 增加语域标签列(formal、informal、slang),数据来自 WordNet 和 Wiktionary 的部分标注。

应用端的 `app` schema 见 [架构设计](architecture.md)。

返回 [开发计划](plan.md)。
