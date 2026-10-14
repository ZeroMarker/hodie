# 词库构建

来源与许可见 [词库来源选择](../../docs/vocab-sources.md)。原始数据和产物都在 `data/`,不入库;阶段 3 AI 生成的结果在 `vocab-ai/`,入库。

```bash
scripts/vocab/fetch.sh                      # 下载到 data/raw 并校验 sha256
python3 -m venv .venv && .venv/bin/pip install -r scripts/vocab/requirements.txt
.venv/bin/python -I scripts/vocab/build.py  # 生成 data/build/vocab.db
.venv/bin/python -I scripts/vocab/load_pg.py "$(avn service get mammoth --format '{service_uri}' | sed 's#/defaultdb?#/hodie?#')"  # 导入 Aiven PostgreSQL 的 vocab schema
```

产物为 SQLite,共十一张表:

- `words`:词条、音标、中英释义、词性、词形变化(`exchange`)、CEFR 等级、wordfreq 排名和 Zipf 值、NGSL 排名、是否具体名词(`concrete`,首个名词词义属于动物、植物、食物、人造物、身体、自然物)。`id` 由 `word_ids.tsv` 登记,重建时保持不变,新词追加。
- `word_lists`:词书归属,`list` 取 `zk`、`gk`、`cet4`、`cet6`、`ky`、`ielts`、`toefl`、`gre`、`ngsl`。
- `senses`:Open English WordNet 词义,含释义、英文例句、语域(informal、slang、archaic、vulgar、derogatory)和 lexfile 语义类别。
- `relations`:词间关系,记录源词义;类型有 synonym、antonym、hypernym、hyponym、similar、derived_from、pertainym。
- `languages`:语言代码与名称(取自 Wiktionary 的 Module:languages)。
- `etymologies`:Wiktionary 词源说明(模板已转为纯文本),一词可有多个词源(`etym_no`)。
- `etymology_steps`:结构化的来源链,如 respect ← 中古英语 respect ← 古法语 respect ← 拉丁语 respectus;只取词源第一段。
- `morphemes` / `word_morphemes`:构词拆分(如 inspect = in- + -spect),词缀的原义和来源语言取自词缀自身的词条。
- `collocations`:从 Tatoeba 全部 204 万英文句子统计的搭配,窗口 ±3、logDice ≥ 7、至少出现 5 次,每词最多 5 条;`phrase` 为最常见的原文片段,如 make a decision。
- `examples`:Tatoeba 中英例句(中文已转简体),每词最多 3 句,优先选其余词都更常见的短句;`author` 用于署名。阶段 3 为没有例句的词书词补充 AI 例句(每词 2 条,共 7866 词、15732 条),`source` 为 `ai:opencode/<model>`、`license` 为 `own`、`reviewed` 为 0(Tatoeba 数据为 1)。

wordfreq 数据禁止转成 CSV 再分发,不要把产物导出为 CSV 对外提供。

## 阶段 3:AI 补全

例句、核心义、搭配、词源讲解这些缺口由 opencode 直接按批生成,流程和约定见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md)。每个任务的生成要求写在 `vocab-ai/<任务>/PROMPT.md`,每批生成前重读一遍。

```bash
.venv/bin/python -I scripts/vocab/ai_export.py examples      # 导出输入到 data/ai/input/examples/(每批 100 词)
.venv/bin/python -I scripts/vocab/ai_validate.py examples    # 校验 vocab-ai/examples/,并导出人工抽检 CSV
.venv/bin/python -I scripts/vocab/build.py                   # 重新构建,vocab-ai/ 的结果一并入库
```

- `ai_export.py` 按 `words.id` 排序切批,词集不变时批次可复现;目标集只看原始数据的缺口,不含 `vocab-ai/` 已生成的结果,所以合并入库后重新导出不会错位。`--batch N` 只导一批,`--missing` 只导还没有结果的批次。
- opencode 逐批把结果写到 `vocab-ai/<任务>/NNNN.jsonl`,每行一个词,带 `word_id`、`prompt_version` 和 `model`。
- `ai_validate.py` 按任务规则校验,输出通过率和不通过的 `word_id`;不通过的结果丢弃或重写,不入库。`--review 0` 可跳过抽检导出。
- 入库行 `source` 写 `ai:opencode/<model>`;`reviewed` 先写 0,人工抽检错误率低于 5% 后整批改 1。

2026-10-14 任务 1 全量完成:79 批、7866 个词、15732 条 AI 例句,`ai_validate.py` 校验 7866/7866 通过(`prompt_version=2`)。词书词的例句覆盖从 7120 补到 14986(100%);入库行 `reviewed` 仍为 0,待人工抽检。

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

Tatoeba:72863 对中英句子,8430 词配到 19036 句。阶段 3 任务 1 又为没有例句的 7866 个词书词补了 15732 条 AI 例句(`source=ai:opencode/deepseek-v4.1-flash`)。两者合计 16296 词有例句;词书词覆盖 14986/14986(100%),各词书均 100%(此前:中考 99%、NGSL 95%、高考 92%、CET-4 87%、考研 80%、CET-6 73%、雅思 69%、托福 49%、GRE 29%)。

Wiktionary(2026-10-01 dump):15759 词有词源说明,12805 词有来源链(共 43347 步),5141 词有构词拆分;共 4057 个语素,571 个词缀中 435 个有原义。首次构建需扫描整个 dump,约 17 分钟,抽出的英文段落缓存在 `data/build/wiktionary-en.json.gz`,之后重建约 40 秒。

搭配:7462 词共 23435 条,其中词书词 6347 个。具体名词:3174 词。

已知问题:

- 约 4200 词只因词频入选(不在任何词书或 CEFR 词表中),仍混有少量人名、地名和粗俗词,只用于查词,不进学习队列。
- CEFR 词表有 41 个词条在 ECDICT 中找不到,主要是英式拼写(personalisation)、带重音符号(café)和词组(check-in desk)。
- 搭配按词形统计,同一搭配的不同时态会重复出现,如 pay attention 和 paid attention。
- 词书词的例句缺口已由阶段 3 任务 1 的 AI 例句补齐(14986/14986,100%);AI 例句 `reviewed` 仍为 0,须人工抽检后置 1。
- AI 例句为满足「其余词更常见」的规则,用词偏简单:old 出现在约 17% 的句子里(2645/15732),个别句子语义别扭(如 brandish 的「挥舞那块旧金子」)。人工抽检时重点看这两点,必要时提升 `prompt_version`,要求用词多样。
- 词源文本是简化渲染,少数模板被直接丢弃,句子偶有缺词;阶段 3 用 LLM 讲解词源时应以 `etymology_steps` 为准。
- 来源链只认 inh、der、bor 等模板和紧跟 from 的 {{m}},「past participle of」这类写法的环节会漏掉(如 inspect 缺 inspicio)。
- 同形词缀不区分来源,如英语 in-(进入)与拉丁语 in-(否定)合并为一条。
- ECDICT 的雅思、托福标签数量偏多,考试标签仍待对照大纲抽检。

## PostgreSQL

线上库为 Aiven 的 `mammoth` 服务(PostgreSQL 18,免费版 1GB),数据库 `hodie`。词库在 `vocab` schema,`public` 留给用户和学习记录。`load_pg.py` 先导入 `vocab_new`,再在同一事务里替换 `vocab`,约 40 秒,导入期间线上可读;旧 schema 用 CASCADE 删除,所以 `public` 下的表不要对 `vocab` 建外键。导入后 `senses.examples` 转为 jsonb,另加 `lower(word)` 索引。2026-10-14 导入后 `vocab` 占 79MB,整库 87MB。
