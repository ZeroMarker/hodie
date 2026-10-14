# 词库构建

来源与许可见 [词库来源选择](../../docs/vocab-sources.md)。原始数据和产物都在 `data/`,不入库。

```bash
scripts/vocab/fetch.sh                      # 下载到 data/raw 并校验 sha256
python3 -m venv .venv && .venv/bin/pip install -r scripts/vocab/requirements.txt
.venv/bin/python -I scripts/vocab/build.py  # 生成 data/build/vocab.db
```

产物为 SQLite,五张表:

- `words`:词条、音标、中英释义、词性、词形变化(`exchange`)、CEFR 等级、wordfreq 排名和 Zipf 值、NGSL 排名。
- `word_lists`:词书归属,`list` 取 `zk`、`gk`、`cet4`、`cet6`、`ky`、`ielts`、`toefl`、`gre`、`ngsl`。
- `senses`:Open English WordNet 词义,含释义、英文例句和语域(informal、slang、archaic、vulgar、derogatory)。
- `relations`:词间关系,记录源词义;类型有 synonym、antonym、hypernym、hyponym、similar、derived_from、pertainym。
- `examples`:Tatoeba 中英例句(中文已转简体),每词最多 3 句,优先选其余词都更常见的短句;`author` 用于署名。

wordfreq 数据禁止转成 CSV 再分发,不要把产物导出为 CSV 对外提供。

## 2026-10-14 构建结果

共 21181 词,其中 8804 词有 CEFR 等级。

| 词书 | 词数 |
| --- | --- |
| 中考 | 1603 |
| 高考 | 3677 |
| CET-4 | 3849 |
| CET-6 | 5407 |
| 考研 | 4801 |
| 雅思 | 5040 |
| 托福 | 6974 |
| GRE | 7504 |
| NGSL | 2809 |

WordNet:19504 词有词义,共 58876 个词义,约 23.8 万条关系;947 个词义带语域标签。

Tatoeba:72863 对中英句子,8430 词配到 19036 句。各词书例句覆盖率:中考 99%、NGSL 95%、高考 92%、CET-4 87%、考研 80%、CET-6 73%、雅思 69%、托福 49%、GRE 29%。

已知问题:

- 约 4200 词只因词频入选(不在任何词书或 CEFR 词表中),仍混有少量人名、地名和粗俗词,只用于查词,不进学习队列。
- CEFR 词表有 41 个词条在 ECDICT 中找不到,主要是英式拼写(personalisation)、带重音符号(café)和词组(check-in desk)。
- 中高级词书的例句覆盖不足,缺口由阶段 3 的 AI 生成例句补齐(须人工抽检)。
- ECDICT 的雅思、托福标签数量偏多,考试标签仍待对照大纲抽检。
