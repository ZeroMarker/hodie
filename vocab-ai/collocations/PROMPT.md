# 任务 3:补齐搭配 · 生成要求

本文件是 `vocab-ai/collocations/` 的生成标准,每批生成前重读一遍,保证不同会话之间一致。
任务定义见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md),校验规则见 [ai_validate.py](../../scripts/vocab/ai_validate.py)。

- `prompt_version`:**2**(改动本文要求时提升,只重做受影响的批次;版本 1 的结果经人工抽检
  删除了低价值的「功能词搭配」,仍按本条校验)
- 入库 `source`:`ai:opencode/<model>`(`model` 写本批实际用的模型)
- 入库 `freq`、`log_dice`:**NULL**(AI 搭配没有 Tatoeba 统计值)

## 做什么

为每批输入里的每个词书词写出 **1 到 3 条真实常见的搭配**,补进 `collocations` 表。
这些词都没有 Tatoeba 统计出来的搭配(那些词已在库里),所以由你会话直接补。

## 输入

`data/ai/input/collocations/NNNN.json`(由 `ai_export.py` 生成,每批 100 词):

```json
{
  "task": "collocations",
  "prompt_version": 1,
  "batch": "0001",
  "total_batches": 87,
  "words": [
    {
      "word_id": 19511,
      "word": "abandonment",
      "zh": "放弃, 抛弃, 放纵",
      "pos": "n.",
      "cefr": null,
      "exchange": "s:abandonments"
    }
  ]
}
```

- `word`:目标词;`zh`:ECDICT 第一行的核心中文义;`pos`:词性标记(可能为 null);
  `cefr`:CEFR 等级(可能为 null);`exchange`:词形变化(`s:` 复数、`p:`/`d:` 过去式/过去分词、`3:` 第三人称单数,可能没有)。只用这些输入。

## 输出

写到 `vocab-ai/collocations/NNNN.jsonl`,**每行一个词**,行数与输入词数一致、`word_id` 一一对应:

```json
{"word_id": 19511, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "collocations": [{"phrase": "fear of abandonment", "partner": "fear", "zh": "被遗弃的恐惧"}, {"phrase": "abandonment issues", "partner": "issue", "zh": "遗弃创伤"}, {"phrase": "total abandonment", "partner": "total", "zh": "彻底的放弃"}]}
```

- `collocations` 是 1 到 3 个对象的数组;**按常见程度从高到低排列**,第一条最常用。
- 每个对象:
  - `phrase`:搭配原文,2 到 6 个英文词;
  - `partner`:搭配里的**另一个词**,必须是**单个词**、写**原形**(词典里的形式),不要写变化形式;
  - `zh`:这条搭配的简短中文释义。
- `reviewed` 先写 `0`;人工抽检错误率低于 5% 后整批改 `1`。

## 生成要求

1. **只写真实常见的固定搭配**:动宾(make a decision)、形名(heavy rain)、动宾加介词(look after)、介词短语(at risk)、副形(deeply concerned)等都算。
   不要临时拼凑、不要写不地道或语义说不通的组合。
2. **不要给功能词写搭配**:目标词是介词、代词、连词、限定词、助动词、疑问副词等封闭类词
   (如 by、him、where、into、the、of、not)时,像 by the way、with him、where else、into pieces 这种
   几乎全是功能词、学习价值很低的组合不要写;这类词**可以一条都不写**(输出空数组 `[]`)。
   如果确实要写,必须是 look after、turn off 这类含实义词的固定说法。
3. **`phrase` 必须包含目标词或其变化形式**。目标词是多词条目(如 `account for`)时,按原样连续写出。
   用 `exchange` 里登记的屈折形式没问题。
4. **`partner` 必须能在词库里找到**——校验会用 `tatoeba.form_map` 查它,查不到直接判不通过。
   挑最常见的实词或介词做搭配词(make、take、heavy、strong、fear、issue、at、in、on 等);
   不要用专有名词(人名、地名)、生僻词、缩写。
   写之前可以逐个核对:
   ```bash
   .venv/bin/python -I -c "import sqlite3;db=sqlite3.connect('data/build/vocab.db');print(db.execute(\"select word from words where word=?\", ('fear',)).fetchone())"
   ```
   或者写完直接跑校验(见下),按报出的 `word_id` 重写。
5. **`partner` 必须真的出现在 `phrase` 里**,且**不能是目标词本身**。同一词的多条搭配,`partner` 不能重复,
   `phrase` 也不能重复。
6. 一个词的搭配要**覆盖不同义项/不同句式**,不要三条都一个模子(如都是 `adj + 名词`)。
7. 中文用简体,简短自然,不加句号。
8. 不编造事实、不写冒犯性内容;避免政治、宗教等敏感语境。

## 自检清单

写完一批后逐条对照,不合规的当场重写:

- [ ] 每行 `word_id` 与输入一一对应,行数一致,没有漏词或重复。
- [ ] 每条搭配 0 到 3 个(目标词是功能词时可留空),`phrase` 2 到 6 个词,且含目标词或其变化形式。
- [ ] 每个 `partner` 是单个词、是原形,能在词库里查到,且出现在对应 `phrase` 里。
- [ ] 同一词的 `partner` 和 `phrase` 都不重复。
- [ ] 每条都有简短中文释义;功能词组合(by the way、with him 类)已删除。
- [ ] `prompt_version` 为 2,`model` 写本批实际用的模型,`reviewed` 为 0。

## 例子

合规(目标词 `abandonment`):

```json
{"word_id": 19511, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "collocations": [{"phrase": "fear of abandonment", "partner": "fear", "zh": "被遗弃的恐惧"}, {"phrase": "abandonment issues", "partner": "issue", "zh": "遗弃创伤"}]}
```

不合规,别这样写:

- `{"phrase": "abandonment the", "partner": "the", "zh": "放弃"}` —— 没意义的组合,`the` 不能作搭配词。
- `{"phrase": "feel abandoned", "partner": "abandoned", "zh": "感到被抛弃"}` —— `partner` 是目标词的变化形式,等于目标词本身。
- `{"phrase": "emotional abandonment by peers", "partner": "peer", "zh": "被同伴情感抛弃"}` —— 7 个词,超长;`peer` 偏生僻。
- 三条搭配都是 `X abandonment` 的同一个名词短语。

## 流程

1. 读 `data/ai/input/collocations/NNNN.json`。
2. 按上述要求写 `vocab-ai/collocations/NNNN.jsonl`。
3. `.venv/bin/python -I scripts/vocab/ai_validate.py collocations --batch NNNN`,按输出的 `word_id` 重写不通过的词,直到通过率 100%。
4. 通过后提交,再进入下一批;中断后从 `--missing` 的批次继续。

返回 [词库构建](../../scripts/vocab/README.md)。
