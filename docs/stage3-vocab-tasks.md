# 阶段 3 词库任务(交给 opencode)

2026-10-14

阶段 1 到 2 中不依赖 AI 的词库工作已完成(见 [scripts/vocab](../scripts/vocab/README.md))。本文列出阶段 3 中需要用 LLM 补齐的词库数据,交给 opencode 实施。学习功能本身(AI 对话、造句批改)不在本文范围内。

## 现状

「词书词」指出现在 `word_lists` 中的词,共 14986 个,是学习队列的全部来源。

| 数据 | 词书词覆盖 | 缺口 |
| --- | --- | --- |
| 中英例句(`examples`,Tatoeba) | 7120 | 7866 词没有例句 |
| 搭配(`collocations`,Tatoeba logDice 统计) | 6347 | 8639 词没有搭配 |
| WordNet 词义(`senses`) | 14330 | 其中 10105 词是多义词,尚未确定哪个词义对应 ECDICT 的核心中文义 |
| 词源来源链(`etymology_steps`) | 10489 | 有数据但没有中文讲解 |

## 通用约定

所有任务都遵守以下约定,保证可复现、可审核、成本可控。

1. **生成与构建分离**:生成脚本放在 `scripts/vocab/ai_*.py`,结果写入 `data/ai/<任务>.jsonl`,每行带 `word_id`、`model`、`prompt_version` 和生成时间。`build.py` 只读取这些文件合并入库,不调用 API。
2. **增量与缓存**:已生成的 `word_id` + `prompt_version` 不重复请求;修改 prompt 时提升 `prompt_version`。
3. **模型**:生成脚本只依赖兼容 OpenAI 的 Chat Completions 接口,通过环境变量 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 配置,不在代码里写死提供方。默认按 DeepSeek V4.1 Flash 设计 prompt(输入 0.15、输出 0.6 美元每百万 token)。每次请求处理 20 个词,要求输出 JSON。
    - opencode 自身的 Go 订阅(`opencode-go` 提供方)只用于 opencode 写代码,不用于批量生成:Go 说明它面向编程智能体流量并监控滥用,而且每 5 小时只能用月额度的 20%。批量生成请用 DeepSeek 官方 API 或其他按量计费的 key。
    - 粗略估算:四个任务共约 3.7 万个词次,约 1900 次请求,约 1500 万输入 token、500 万输出 token,按上述价格约 5 美元。以试跑实测为准。
4. **校验**:每个任务都要有程序校验(规则见各任务),不通过的结果丢弃或重试,不入库。
5. **来源标记**:入库行的 `source` 写 `ai:<model>`,并加 `reviewed`(0 或 1)列。应用只展示 `reviewed = 1` 的数据,或在界面上标出「AI 生成」;这一点由产品决定,先两种都支持。
6. **人工抽检**:每个任务随机抽 200 条导出为 `data/ai/review/<任务>.csv`,供人工检查。抽检错误率低于 5% 时,整批标为 `reviewed = 1`。
7. **成本**:先用 50 个词试跑,记录 token 用量,估算全量费用后写进本文,再跑全量。
8. **不改动现有数据**:Tatoeba、WordNet、Wiktionary 的数据保持原样,AI 数据只做补充。

## 任务 1:补齐例句

为没有例句的 7866 个词书词各生成 2 条中英例句,写入 `examples`。

- **输入**:词、核心中文义(ECDICT 第一行)、词性、CEFR 等级;如有 `collocations`,也一起提供。
- **要求**:英文 6 到 14 个词,使用核心义;句中其余词尽量比目标词更常用,与 Tatoeba 选句的标准一致。
- **校验**:
    - 用 `tatoeba.form_map` 还原词形后,句中必须包含目标词;
    - 其余词的 `freq_rank` 中位数要低于目标词;
    - 中文非空,且不含英文目标词。
- `license` 写 `own`。

## 任务 2:核心义对应 WordNet 词义

为 10105 个多义词书词确定 ECDICT 核心中文义对应的 WordNet 词义,作为多义词拆卡和图谱展示的依据(见 [单词学习方案](word-learning-plan.md) 的数据缺口)。

- **输入**:词、ECDICT 中文释义全文、该词全部 `senses`(id、词性、英文释义)。
- **输出**:`core_sense_id`,必须是输入里给出的 sense id 之一;无法判断时输出 null。
- **入库**:`words` 增加 `core_sense_id` 列。
- **校验**:输出的 id 必须属于该词;词性要和中文释义第一行标注的词性一致(如 `n.` 对应 n,`vt.` 和 `vi.` 对应 v)。

## 任务 3:补齐搭配

为没有搭配的 8639 个词书词各生成至多 3 条常见搭配,写入 `collocations`。

- **要求**:只输出真实常见的搭配(动宾、形名、介词短语等),附一条中文释义。
- **校验**:搭配必须包含目标词或其变化形式;搭配中的另一个词必须能在 `words` 中找到,作为 `partner_id`。`freq` 和 `log_dice` 置空,所以入库前需要把这两列改为可空。
- 现有 Tatoeba 搭配有同一搭配的不同时态重复的问题(如 pay attention 和 paid attention),可以顺手按搭配词的原形合并,但这一步不用 LLM。

## 任务 4:词源中文讲解

为有来源链的 10489 个词书词生成一段中文词源讲解,供词卡 L4 阶段展示(见 [单词学习方案](word-learning-plan.md) 的题型阶梯)。

- **输入**:只用库里已有的 `etymology_steps`、`etymologies.text` 和 `word_morphemes`(含语素原义)。
- **要求**:中文,不超过 120 字;说明词根含义,以及它如何引申到今天的词义。不得出现输入中没有的语言、词形或年代,以免编造。
- **入库**:新表 `etymology_notes`(`word_id`、`text`、`source`、`reviewed`)。
- **校验**:讲解中出现的拉丁字母词形,都必须出现在输入里。

## 交付

- 每个任务单独提交,提交说明写明生成条数、校验通过率、抽检结果和实际费用。
- 更新 `scripts/vocab/README.md` 的构建结果,以及本文的「现状」表。
- 重新构建后,运行 `load_pg.py` 更新线上 `vocab` schema(连接方式见 README)。

返回 [开发计划](plan.md)。
