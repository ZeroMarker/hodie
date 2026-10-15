# 任务 1:补齐例句 · 生成要求

本文件是 `vocab-ai/examples/` 的生成标准,每批生成前重读一遍,保证不同会话之间一致。
任务定义见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md),校验规则见 [ai_validate.py](../../scripts/vocab/ai_validate.py)。

- `prompt_version`:**3**(改动本文要求时提升,只重做受影响的批次;版本 2 的旧结果
  按原要求校验后保留,只把命中原「用词单调」问题的词重做成版本 3)
- 入库 `source`:`ai:opencode/<model>`(`model` 写本批实际用的模型)
- 入库 `license`:`own`

## 做什么

为每批输入里的每个词各写 **2 条中英例句**,补进 `examples` 表。目标是让例句里只出现一个「难点」——目标词本身,其余词都更常用,和 Tatoeba 选句的标准一致。

## 输入

`data/ai/input/examples/NNNN.json`(由 `ai_export.py` 生成,每批 100 词):

```json
{
  "task": "examples",
  "prompt_version": 3,
  "batch": "0001",
  "total_batches": 79,
  "words": [
    {
      "word_id": 25,
      "word": "abandonment",
      "zh": "放弃, 抛弃, 放纵",
      "pos": "n.",
      "cefr": null,
      "collocations": ["abandonment issues", "fear of abandonment"]
    }
  ]
}
```

- `zh` 是 ECDICT 的第一行,即核心中文义;`pos` 是词性标记(可能为 null);`collocations` 可能没有。
- 只用这些输入,不要引入别的释义。多义词按 `zh` 给出的核心义造句。

## 输出

写到 `vocab-ai/examples/NNNN.jsonl`,**每行一个词**,行数与输入词数一致、`word_id` 一一对应:

```json
{"word_id": 25, "prompt_version": 3, "model": "deepseek-v4.1-flash", "reviewed": 0, "examples": [{"text_en": "He still struggles with abandonment issues.", "text_zh": "他仍然难以摆脱被遗弃的阴影。"}, {"text_en": "The child's fear of abandonment is understandable.", "text_zh": "这孩子对被遗弃的恐惧是可以理解的。"}]}
```

- `reviewed` 先写 `0`;人工抽检错误率低于 5% 后整批改 `1`。
- 两条例句都要不同,句子内容不要重复。

## 生成要求

1. 英文 **6 到 14 个词**;用完整的句子,语法正确,标点规范。按 `[a-z]+(?:['-][a-z]+)*` 切词:带连字符的复合词(如 `well-being`、`x-ray`)算一个词,缩写点不单独计数。
2. 句中必须出现目标词;可以用 `exchange` 里登记的屈折形式(如 `abandon` 的 `abandoned`、`abandons`),但不能用输入里没有的派生词。
3. 用 `zh` 的核心义。一个句子里只表达这个义项,不要用别的义项凑。
4. **其余词尽量比目标词更常用**。校验会取句中除目标词外每个词的 `freq_rank`(库里没有的词按 100000 计),要求中位数**严格小于**目标词的 `freq_rank`。多用 this、the、for、with 这类常见虚词和常用实词,避免生僻词、人名、数字。
5. 中文用简体,**必须非空**,是自然的翻译,并且**不能出现英文目标词本身**。
6. **中文必须用全角标点**(，。！？：；、等),不得出现半角 `,` `.` `!` `?` `:` `;`。校验会逐句检查,出现半角即不通过。
7. **用词要多样**,不要反复用同一个词(尤其是 `old`、`whole`、`thing`、`person`、`people` 这类泛词)来凑够词数。同一个词在不同句子里应尽量换用别的表达。
8. **不得用 `old` 或 `whole` 凑词**(目标词本身是 old/whole 时除外);出现即不通过。
9. **不得用无意义的 `do`/`does`/`did` 强调式**(如 `They did make …`、`She does like …`)。需要强调时改用自然的说法或直接去掉 do;出现 do/does/did 后紧跟原形动词即不通过。
10. 不编造事实、不写冒犯性内容;避免政治、宗教等敏感语境。

## 自检清单

写完一批后逐条对照,不合规的当场重写:

- [ ] 英文词数在 6-14 之间(按 `[a-z]+(?:['-][a-z]+)*` 切词)。
- [ ] 句子里能找到目标词或其 `exchange` 形式;连字符词(如 `three-dimensional`)、多词条目(如 `account for`)必须按原样写出。
- [ ] 除目标词外,其余词的中位词频低于目标词;目标词越常见(freq_rank 越小)越要小心。
- [ ] 中文非空、是简体、不含英文目标词。
- [ ] 中文只用全角标点,没有半角 `,` `.` `!` `?` `:` `;`。
- [ ] 没有用 `old`、`whole` 凑词(目标词本身除外),没有 `do`/`does`/`did` + 原形动词的强调式。
- [ ] 用词多样,没有反复套用同一个泛词。
- [ ] 每词恰好 2 条,两行 `word_id` 与输入一致,没有重复或漏词。

## 例子

合规(目标词 `abash`,freq_rank 很靠后,其余词都常见):

```json
{"text_en": "She never meant to abash him in front of his friends.", "text_zh": "她并不是想在朋友面前让他难堪。"}
```

不合规,别这样写:

- `{"text_en": "Abashed.", "text_zh": "羞愧。"}` —— 词数不足,中文太短。
- `{"text_en": "The abashed researcher's colleagues were flabbergasted.", "text_zh": "这位 abashed 研究员的同事们都目瞪口呆。"}` —— 其余词生僻,中文混入英文目标词。
- `{"text_en": "They did find the old manuscript in that whole room.", "text_zh": "他们确实在那个房间里找到了那份旧手稿。"}` —— 用 `old`、`whole` 凑词,又用了 `did find` 强调式。
- 两条例句意思一样,只是换了个人称。

## 流程

1. 读 `data/ai/input/examples/NNNN.json`。
2. 按上述要求写 `vocab-ai/examples/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py examples --batch NNNN`,按输出的 `word_id` 重写不通过的词。
4. 通过后提交,再进入下一批;中断后从 `--missing` 的批次继续。

返回 [词库构建](../../scripts/vocab/README.md)。
