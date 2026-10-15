# 任务 2:核心义对应 WordNet 词义 · 生成要求

本文件是 `vocab-ai/core_sense/` 的生成标准,每批生成前重读一遍,保证不同会话之间一致。
任务定义见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md),校验规则见 [ai_validate.py](../../scripts/vocab/ai_validate.py)。

- `prompt_version`:**3**(改动本文要求时提升,只重做受影响的批次)
- 入库位置:`words.core_sense_id`(列由 [build.py](../../scripts/vocab/build.py) 维护)

## 做什么

为每个多义词书词判断它**在现代英语中最常用的义项**对应哪一个 WordNet 词义,结果写 `core_sense_id`。这一步是多义词拆卡和图谱展示的依据(见 [单词学习方案](../../docs/word-learning-plan.md) 的数据缺口)。

## 输入

`data/ai/input/core_sense/NNNN.json`(由 `ai_export.py` 生成,每批 100 词):

```json
{
  "task": "core_sense",
  "prompt_version": 3,
  "batch": "0001",
  "total_batches": 102,
  "words": [
    {
      "word_id": 24,
      "word": "abandoned",
      "zh": "a. 被抛弃的, 无约束的, 恣意放荡的",
      "positions": ["a"],
      "senses": [
        {"id": "oewn-abandoned__5.00.00.uninhabited.00", "pos": "a", "def": "forsaken by owner or inhabitants"},
        {"id": "oewn-abandoned__5.00.00.uninhibited.00", "pos": "a", "def": "unrestrained and uninhibited"}
      ]
    }
  ]
}
```

- `zh` 是 ECDICT 释义**全文**(可能多行,每行行首可能有 `n.`、`a.`、`vt.` 等词性标记);行序只是词典的排列,**不代表常用程度**。
- `positions` 是释义里出现过的 WordNet 词性(如 `["n","v"]`),来源就是 `zh` 各行行首,列出来只为方便对照,**不是只能选第一行的词性**。
- `senses` 是该词在 Open English WordNet 里的全部词义,`id` 是词义标识,`def` 是英文释义。
- 只用这些输入,不要引入别的释义或自己记忆里的其他词义。

## 输出

写到 `vocab-ai/core_sense/NNNN.jsonl`,**每行一个词**,行数与输入词数一致、`word_id` 一一对应:

```json
{"word_id": 24, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": "oewn-abandoned__5.00.00.uninhabited.00"}
{"word_id": 25, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": null}
```

- `core_sense_id` 必须是该词 `senses` 里出现过的 `id` 之一,或 `null`;**不得编造 id**。
- `reviewed` 先写 `0`;人工抽检错误率低于 5% 后整批改 `1`。

## 判断要求

1. **选该词在现代英语里最常用的义项**,不受释义行顺序和第一行词性限制:
   - ECDICT 的 `zh` 常把冷僻、古旧、专业或已经少用的义项排在前面(如 settle、fine、meet、bound 的第一行都是冷僻义)。遇到这种情况要往后看,选现代英语中真正常用、学习者最可能遇到的义项。
   - **参考 ECDICT 的全部释义**(不只第一行),也参考该词全部 `senses` 的词性和释义;某个义项也许不在第一行,但只要它是该词今天最常见的意思,就选它对应的词义。
   - 说不准哪个更常用时,以「今天的口语和书面语里最常出现」为准,而不是以词典的排列顺序为准。
2. **词性要和 ECDICT 释义里出现过的词性一致(任意一行即可,不必是第一行)**:
   - `n.` → `n`;`a.` → `a`(WordNet 的 `s` 也算 `a`);`vt.` `vi.` `v.` → `v`;`adv.` → `r`;`pl.` → `n`。
   - 只要所选词义的词性出现在 `zh` 的**任意一行**行首,就算通过;例如 settle 的 `zh` 有 `n.` 和 `vt.`/`vi.` 三行,选动词义或名词义都合规。
   - `positions` 为空(释义没有任何词性标记)时,不强制词性,但仍选最常用的义项。
   - 校验会检查这一条;选了 `zh` 里任何一行都没有的词性,直接判不通过。
3. **确实无法判断就写 `null`**,不要硬选一个勉强沾边的:
   - 该词在 WordNet 里没有能对应常用义的词义(WordNet 缺该义项);
   - 多个词义都无法明显对应;
   - 词本身是词组、缩写或专名,词义与 ECDICT 释义对不上。
4. 语域不符时也倾向 `null`:要选的是通用义,而唯一能对应的词义标着 slang、vulgar、archaic、derogatory。
5. 选**释义最贴近**的那一个;同义或近义多于一个时,选排在前面的(通常更常用/更核心)。

## 自检清单

写完一批后逐条对照,不合规的当场重写:

- [ ] 每行 `word_id` 与输入一一对应,行数一致,没有漏词或重复。
- [ ] `core_sense_id` 要么是 `null`,要么逐字符等于该词某个 `senses[].id`。
- [ ] 选的是现代英语里最常用的义项,没有被 ECDICT 的排列顺序或第一行词性带着走。
- [ ] 非 `null` 时,词义 `pos` 出现在 `zh` 的任意一行行首(见上面的对照表)。
- [ ] `prompt_version` 为 3。
- [ ] 该写 `null` 的没有硬选。

## 例子

核心义清楚(目标词 `abandoned`,`zh` 首行是 `a.`,常用义「被抛弃的」):

```json
{"word_id": 24, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": "oewn-abandoned__5.00.00.uninhabited.00"}
```

第一行是冷僻词性,常用义在后面的行(目标词 `settle`,`zh` 首行 `n.` 是「有背长椅」,后面 `vt.`/`vi.` 才有「安顿、解决」;选动词义的词义,词性 `v` 出现在 `vt.`/`vi.` 行,合规):

```json
{"word_id": 16842, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": "oewn-settle__2.31.00.."}
```

该写 `null`(ECDICT 只有领域义,WordNet 只有通用义,对不上):

```json
{"word_id": 8054, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "core_sense_id": null}
```

不合规,别这样写:

- `{"word_id": 24, "core_sense_id": "abandoned"}` —— 不是输入的完整 id。
- `{"word_id": 23, "core_sense_id": "oewn-abandon__3.00.00.."}` —— 词义词性是 `adj`/`s`(= `a`),但 `zh` 没有任何一行是 `a.`,词性不符。
- 因为 settle 的 ECDICT 第一行是「高背长椅」就选长椅义,而忽略它更常用的「安顿、解决」义。
- 因为 `positions` 里第一个是 `n` 就只看名词词义,忽略更常用的动词义。

## 流程

1. 读 `data/ai/input/core_sense/NNNN.json`。
2. 按上述要求写 `vocab-ai/core_sense/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py core_sense --batch NNNN`,按输出的 `word_id` 重写不通过的词。
4. 通过后提交,再进入下一批;中断后从 `--missing` 的批次继续。

返回 [词库构建](../../scripts/vocab/README.md)。
