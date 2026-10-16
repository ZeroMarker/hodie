# 任务 5:全量审核 · 核心义

本文件是 `vocab-ai/review/core_sense/` 的审核标准,每批审核前重读一遍。
被审对象是 `vocab-ai/core_sense/` 的生成结果,审核模型为 `opencode/glm-5.3-flash-free`,
结果记为 **AI 审核**(与人工审核区分)。任务定义见 [阶段 3 词库任务](../../../docs/stage3-vocab-tasks.md)。

- `review_version`:**1**
- `reviewer`:`ai:opencode/glm-5.3-flash-free`
- 输出:`vocab-ai/review/core_sense/NNNN.jsonl`,每行一个词,与输入 `word_id` 一一对应

## 做什么

逐条检查每词选的核心义词义是不是它**在现代英语里最常用的义项**,有没有被 ECDICT 的排列顺序
或冷僻义带着走。**拿不准就判 `ok`,不要过度修改。**

## 输入

`data/ai/input/review-core_sense/NNNN.json`,每批 100 词,每词:

```json
{
  "word_id": 23,
  "word": "abandon",
  "zh": "vt. 放弃, 抛弃, 遗弃, 使屈从, 沉溺, 放纵\nn. 放任, 无拘束, 狂热",
  "positions": ["n", "v"],
  "senses": [
    {"id": "oewn-abandon__1.07.00..", "pos": "n", "def": "the trait of lacking restraint or control; reckless freedom from inhibition or worry"},
    {"id": "oewn-abandon__2.40.00..", "pos": "v", "def": "forsake, leave behind"}
  ],
  "core_sense_id": "oewn-abandon__2.40.00..",
  "prompt_version": 3
}
```

- `core_sense_id`:当前结果(被审内容),是该词 `senses[].id` 之一,或 `null`。
- `zh`:ECDICT 释义全文;`positions`:释义里出现过的词性;`senses`:该词全部 WordNet 词义。

## 输出

写到 `vocab-ai/review/core_sense/NNNN.jsonl`,每行:

```json
{"word_id": 23, "verdict": "ok", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 16842, "verdict": "fix", "reason": "选了冷僻的名词义「高背长椅」，现代英语最常用的是动词「安顿、解决」", "fix": {"core_sense_id": "oewn-settle__2.31.00.."}, "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 8054, "verdict": "reject", "reason": "几个词义都对不上常用义，应写 null 但当前选了领域义", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
```

- `verdict`:`ok` / `fix` / `reject`。
- `reason`:不是 `ok` 时必填,一句话说明问题。
- `fix`:仅 `fix` 时填,是该词**核心义的完整改正**,格式与原结果相同,即
  `{"core_sense_id": "<该词 senses 里的某个 id>"}`(改正为 `null` 时写 `{"core_sense_id": null}`)。
  改正必须通过 `python -I scripts/vocab/ai_validate.py review-core_sense --batch NNNN` 的原校验:
  id 属于该词,且所选词义的词性出现在 `zh` 任意一行(`n.`→n、`a.`/`s.`→a、`vt.`/`vi.`/`v.`→v、`adv.`→r、`pl.`→n)。
- `reviewer`、`review_version` 每行都要有。

`ok` 与 `fix` 入库后 `core_sense_reviewed = 1`;`reject` 保持 0,不做修改。

## 判据

1. **是否是现代英语最常用的义项**:把当前选的词义和 `senses` 里其他候选比一比,若明显是更冷僻、
   更专业或更古旧的义项(ECDICT 常把这类排前面),判 `fix`,改选常用义对应的词义。
2. **词义与 `zh` 是否对得上**:当前词义的 `def` 要和 `zh` 里某条释义对应;明显对不上判 `fix`。
3. **该写 `null` 却硬选**:词义与 ECDICT 释义都对不上、或用当前词义会让学习者误解,判 `fix`(改 `null`)。
   反过来,当前是 `null` 但 `senses` 里确实有能对应常用义的词义,判 `fix`(补上)。
4. **词性**:改正不得违反词性规则(见上);拿不准某义项是否更常用时不要改。
5. 以下判 `ok`:当前选择合理、只是还有别的近义候选;有争议但说不清谁更常用;冷僻词本身没有公认常用义。
   拿不准的一律 `ok`。

## 自检清单

- [ ] 每行 `word_id` 与输入一一对应,行数一致。
- [ ] `reviewer` 为 `ai:opencode/glm-5.3-flash-free`,`review_version` 为 1。
- [ ] `fix` 的行都有 `reason`,其 `core_sense_id` 逐字符等于该词某个 `senses[].id`(或 null),
      词性符合 `zh` 任意一行。
- [ ] 没有把「同样合理、只是不同」的选择判成错;拿不准的判了 `ok`。

## 流程

1. 读 `data/ai/input/review-core_sense/NNNN.json`。
2. 写 `vocab-ai/review/core_sense/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py review-core_sense --batch NNNN`,按报错重写不合规的行。
4. 通过后进入下一批。

返回 [任务 5 全量审核](../../../docs/stage3-vocab-tasks.md)。
