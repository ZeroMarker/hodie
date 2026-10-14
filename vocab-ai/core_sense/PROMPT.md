# 任务 2:核心义对应 WordNet 词义 · 生成要求

本文件是 `vocab-ai/core_sense/` 的生成标准,每批生成前重读一遍,保证不同会话之间一致。
任务定义见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md),校验规则见 [ai_validate.py](../../scripts/vocab/ai_validate.py)。

- `prompt_version`:**1**(改动本文要求时提升,只重做受影响的批次)
- 入库位置:`words.core_sense_id`(列由 [build.py](../../scripts/vocab/build.py) 维护)

## 做什么

为每个多义词书词判断 ECDICT **核心中文义**对应哪一个 WordNet 词义,结果写 `core_sense_id`。这一步是多义词拆卡和图谱展示的依据(见 [单词学习方案](../../docs/word-learning-plan.md) 的数据缺口)。

## 输入

`data/ai/input/core_sense/NNNN.json`(由 `ai_export.py` 生成,每批 100 词):

```json
{
  "task": "core_sense",
  "prompt_version": 1,
  "batch": "0001",
  "total_batches": 102,
  "words": [
    {
      "word_id": 24,
      "word": "abandoned",
      "zh": "a. 被抛弃的, 无约束的, 恣意放荡的",
      "pos": "a.",
      "senses": [
        {"id": "oewn-abandoned__5.00.00.uninhabited.00", "pos": "a", "def": "forsaken by owner or inhabitants"},
        {"id": "oewn-abandoned__5.00.00.uninhibited.00", "pos": "a", "def": "unrestrained and uninhibited"}
      ]
    }
  ]
}
```

- `zh` 是 ECDICT 释义**全文**(可能多行);**第一行**是核心义,行首已单独抽成 `pos`。
- `senses` 是该词在 Open English WordNet 里的全部词义,`id` 是词义标识,`def` 是英文释义。
- 只用这些输入,不要引入别的释义或自己记忆里的其他词义。

## 输出

写到 `vocab-ai/core_sense/NNNN.jsonl`,**每行一个词**,行数与输入词数一致、`word_id` 一一对应:

```json
{"word_id": 24, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": "oewn-abandoned__5.00.00.uninhabited.00"}
{"word_id": 25, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": null}
```

- `core_sense_id` 必须是该词 `senses` 里出现过的 `id` 之一,或 `null`;**不得编造 id**。
- `reviewed` 先写 `0`;人工抽检错误率低于 5% 后整批改 `1`。

## 判断要求

1. **只看第一行**。`zh` 的第一行是 ECDICT 的核心义,后面的行(常带 `[经]` `[计]` 等领域标记)只作参考,不要用来决定核心义。选择与该核心义最贴近的词义。
2. **词性必须和 `pos` 一致**:
   - `n.` → `n`;`a.` → `a`(WordNet 的 `s` 也算 `a`);`vt.` `vi.` `v.` → `v`;`adv.` → `r`;`pl.` → `n`。
   - `pos` 为 `null`,或为 `num.` `prep.` `pron.` `interj.` 等 WordNet 没有对应词性的标记时,不强制词性,但仍选与核心义最接近的词义。
   - 校验会检查前一组;选了词性不符的词义直接判不通过。
3. **确实无法判断就写 `null`**,不要硬选一个勉强沾边的:
   - 核心义在 WordNet 里没有对应词义(WordNet 缺该义项);
   - 多个词义都无法明显对应核心义;
   - 词本身是词组、缩写或专名,词义与 ECDICT 释义对不上。
4. 语域不符时也倾向 `null`:核心义是通用义,而唯一能对应的词义标着 slang、vulgar、archaic、derogatory。
5. 选**释义最贴近**的那一个;同义或近义多于一个时,选排在前面的(通常更常用/更核心)。

## 自检清单

写完一批后逐条对照,不合规的当场重写:

- [ ] 每行 `word_id` 与输入一一对应,行数一致,没有漏词或重复。
- [ ] `core_sense_id` 要么是 `null`,要么逐字符等于该词某个 `senses[].id`。
- [ ] 非 `null` 时,词义 `pos` 与输入 `pos` 按上面的对照一致。
- [ ] `prompt_version` 为 1。
- [ ] 该写 `null` 的没有硬选。

## 例子

核心义清楚(目标词 `abandoned`,`pos` 为 `a.`,核心义「被抛弃的」):

```json
{"word_id": 24, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": "oewn-abandoned__5.00.00.uninhabited.00"}
```

该写 `null`(核心义是 ECDICT 的领域义,WordNet 只有通用义,对不上):

```json
{"word_id": 8054, "prompt_version": 1, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": null}
```

不合规,别这样写:

- `{"word_id": 24, "core_sense_id": "abandoned"}` —— 不是输入的完整 id。
- `{"word_id": 23, "pos": "n.", "core_sense_id": "oewn-abandon__2.40.00.."}` —— 核心义第一行是 `vt.`(对应 `v`),选了名词词义,词性不符。

## 流程

1. 读 `data/ai/input/core_sense/NNNN.json`。
2. 按上述要求写 `vocab-ai/core_sense/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py core_sense --batch NNNN`,按输出的 `word_id` 重写不通过的词。
4. 通过后提交,再进入下一批;中断后从 `--missing` 的批次继续。

返回 [词库构建](../../scripts/vocab/README.md)。
