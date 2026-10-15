# 任务 4:词源中文讲解 · 生成要求

本文件是 `vocab-ai/etymology/` 的生成标准,每批生成前重读一遍,保证不同会话之间一致。
任务定义见 [阶段 3 词库任务](../../docs/stage3-vocab-tasks.md),校验规则见 [ai_validate.py](../../scripts/vocab/ai_validate.py)。

- `prompt_version`:**2**(改动本文要求时提升,只重做受影响的批次;版本 1 中半角标点已机械转全角,
  只重做语言名与输入不符、或仍有其他问题的词)
- 入库位置:`etymology_notes`(新表,列 `word_id`、`text`、`source`、`reviewed`,由 [build.py](../../scripts/vocab/build.py) 维护)
- 入库 `source`:`ai:opencode/<model>`(`model` 写本批实际用的模型)

## 做什么

为每个有来源链的词书词写**一段中文词源讲解**,供词卡 L4 阶段展示。讲解要说明词根的含义,
以及它如何引申到今天的词义。**只根据输入里的词源资料写,不得编造。**

## 输入

`data/ai/input/etymology/NNNN.json`(由 `ai_export.py` 生成,每批 100 词):

```json
{
  "task": "etymology",
  "prompt_version": 2,
  "batch": "0001",
  "total_batches": 105,
  "words": [
    {
      "word_id": 15840,
      "word": "respect",
      "etymologies": [
        {
          "etym_no": 1,
          "text": "From Middle English respect, from Old French respect, from Latin respectus(a looking at, regard, respect), perfect passive participle of Latin respicio(look at, look back upon, respect), from Latin re-(back) + Latin specio(to see), equivalent to re- + -spect.",
          "steps": [
            {"type": "inherited", "lang": "Middle English", "term": "respect", "gloss": null},
            {"type": "derived_from", "lang": "Old French", "term": "respect", "gloss": null},
            {"type": "derived_from", "lang": "Latin", "term": "respectus", "gloss": "a looking at, regard, respect"}
          ],
          "morphemes": [
            {"form": "re-", "kind": "prefix", "lang": "Middle English", "meaning": "again, anew", "gloss": null},
            {"form": "-spect", "kind": "suffix", "lang": "Latin", "meaning": "To look at, perceive, or observe.", "gloss": null}
          ]
        }
      ]
    }
  ]
}
```

- `word`:目标词;`etymologies`:按来源分组,通常只有一组,用 `etym_no` 最小的一组(主要来源)即可。
- 每组里:
  - `steps`:来源链,每步是 `{type, lang, term, gloss}`,`lang` 是语言的英文名,`term` 是该语言里的词形,
    `gloss` 是该词形的释义(可能为 null);
  - `text`:Wiktionary 的词源说明全文(英文,可能没有);
  - `morphemes`:构词拆分,每项是 `{form, kind, lang, meaning, gloss}`,`meaning` 是语素原义(可能为 null)。
- **只用输入里给出的这些内容**(`steps`、`text`、`morphemes`)和词本身,不要引入任何别的词源资料或自己记忆里的词根。

## 输出

写到 `vocab-ai/etymology/NNNN.jsonl`,**每行一个词**,行数与输入词数一致、`word_id` 一一对应:

```json
{"word_id": 15840, "prompt_version": 2, "model": "deepseek-v4.1-flash", "reviewed": 0, "text": "源自拉丁语 respectus（回望、注视），由 re-（回）加 -spect（看）构成，本义是回头看，引申为对他人的敬重与尊重。"}
```

- `reviewed` 先写 `0`;人工抽检错误率低于 5% 后整批改 `1`。

## 生成要求

1. **中文,不超过 120 字**(含标点)。用简体,自然通顺的一句话或两句话,不用换行。
2. 说清**词根(或词缀)的含义**,以及它**如何引申到今天的词义**。资料多就写根和引申,资料少就写最可靠的一两步。
3. **只能用输入里有的语言、词形和年代**:
   - 语言名用中文,由输入里的 `lang`(英文名)翻译而来,如 Latin→拉丁语、Old French→古法语、
     Middle English→中古英语、Old English→古英语、Early Modern English→早期现代英语、
     Proto-West Germanic→原始西日耳曼语、Ancient Greek→古希腊语、Proto-Indo-European→原始印欧语。
     **输入里没有的语言一个字都不能提**;输入写的是哪一层就译哪一层,不要自行上升或下降到别的语言阶段
     (输入是 Old French 就不要写中古法语,输入是 Proto-West Germanic 就不要写原始日耳曼语)。
   - 提到的**拉丁字母词形,必须逐字出现在输入里**(一般在 `steps[].term`、`morphemes[].form`、`gloss` 或 `text` 里)。
     引用时照抄输入里的写法(如 `respectus`、`re-`、`-spect`),不要改拼写、不要加词形变化、不要写输入里没有的亲属形式。
   - **不得出现阿拉伯数字或年份**(不要写「16 世纪」「1890 年」这类输入里没有的年代)。
4. 只讲解词源;**不要编造词义**、典故、人名或史实,**也不要补充输入里没有的本义或词义解释**(例如输入只说词根意为「看」,
   就不要自己加上「本义是注视某人」这类输入里没有的说法)。拿不准就写得短一些,宁可少写也不要猜。
5. 不要把英文句子整段抄进来;词形只用来说明来源。不要写与词源无关的评价。
6. **全篇用全角标点**:中文里的逗号、句号、分号、冒号、括号等一律用全角(，。；：（）),不得出现半角
   `,` `.` `;` `:` `(` `)` `!` `?`;拉丁字母词形本身按输入照抄。

### 校验能查的与不能查的

- 程序会检查:字数 ≤ 120、含中文、无阿拉伯数字、**讲解里每一段拉丁字母词形都在输入里出现**、
  **讲解里提到的语言名与输入对应**、**没有半角标点**。
- 程序查不了引申是否合理,这部分靠你按上面的要求自觉;写不准就少写。

## 自检清单

写完一批后逐条对照,不合规的当场重写:

- [ ] 每行 `word_id` 与输入一一对应,行数一致,没有漏词或重复。
- [ ] 每段讲解 ≤ 120 字,是中文,没有阿拉伯数字。
- [ ] 讲解里出现的每个拉丁字母词形(如 `respectus`、`spect`、`re`)都在该词输入里能逐字找到。
- [ ] 只提输入里有的语言(用对应中文名),没有把 Old French 写成中古法语、把 Proto-West Germanic 写成原始日耳曼语这类阶段错位。
- [ ] 没有编造词义、典故、史实、年代,也没有补充输入里没有的本义或词义解释。
- [ ] 全篇是全角标点,没有半角 `,` `.` `;` `:` `(` `)` `!` `?`。
- [ ] `prompt_version` 为 2,`model` 写本批实际用的模型,`reviewed` 为 0。

## 例子

合规(目标词 `respect`,输入同上面示例):

```json
{"word_id": 15840, "prompt_version": 2, "model": "deepseek-v4.1-flash", "reviewed": 0, "text": "源自拉丁语 respectus（回望、注视），由 re-（回）加 -spect（看）构成，本义是回头看，引申为对他人的敬重与尊重。"}
```

不合规,别这样写:

- `{"text": "来自古英语 specan，意为观察。"}` —— 输入里没有古英语,也没有 `specan`,属于编造。
- `{"text": "源自拉丁语 spectare，16 世纪进入英语，意为看。"}` —— `spectare` 和年代都不在输入里。
- `{"text": "respect 这个词很有意思，大家要记住。"}` —— 没讲词源,也没有根据输入写。
- `{"text": "源自中古英语 respect,由拉丁语 re-(回)加 -spect(看)构成,本义是回头看。"}` —— 输入里没有中古英语,标点也用了半角。

## 流程

1. 读 `data/ai/input/etymology/NNNN.json`。
2. 按上述要求写 `vocab-ai/etymology/NNNN.jsonl`。
3. `.venv/bin/python -I scripts/vocab/ai_validate.py etymology --batch NNNN`,按输出里「词形不在输入里」的 `word_id` 重写,直到通过率 100%。
4. 通过后提交,再进入下一批;中断后从 `--missing` 的批次继续。

返回 [词库构建](../../scripts/vocab/README.md)。
