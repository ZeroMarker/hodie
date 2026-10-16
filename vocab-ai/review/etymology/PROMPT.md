# 任务 5:全量审核 · 词源讲解

本文件是 `vocab-ai/review/etymology/` 的审核标准,每批审核前重读一遍。
被审对象是 `vocab-ai/etymology/` 的生成结果,审核模型为 `opencode/glm-5.3-flash-free`,
结果记为 **AI 审核**(与人工审核区分)。任务定义见 [阶段 3 词库任务](../../../docs/stage3-vocab-tasks.md)。
批次 0001-0019 已由 deepseek-v4.1-flash-free 审核,其结果不再重做,`reviewer` 保持原样;
批次 0020 起的 `reviewer` 一律写 `ai:opencode/glm-5.3-flash-free`。

- `review_version`:**1**
- `reviewer`:`ai:opencode/glm-5.3-flash-free`
- 输出:`vocab-ai/review/etymology/NNNN.jsonl`,每行一个词,与输入 `word_id` 一一对应

## 做什么

逐条检查每段词源中文讲解是否正确、是否只依据输入、是否把词源讲成了另一个同形词。
**拿不准就判 `ok`,不要过度修改。**

## 输入

`data/ai/input/review-etymology/NNNN.json`,每批 100 词,每词:

```json
{
  "word_id": 15840,
  "word": "respect",
  "text": "源自拉丁语 respectus（回望、注视），由 re-（回）加 -spect（看）构成，本义是回头看，引申为对他人的敬重与尊重。",
  "prompt_version": 2,
  "etymologies": [
    {
      "etym_no": 1,
      "text": "From Middle English respect, from Old French respect, from Latin respectus ...",
      "steps": [{"type": "derived_from", "lang": "Latin", "term": "respectus", "gloss": "a looking at, regard, respect"}],
      "morphemes": [{"form": "-spect", "kind": "suffix", "lang": "Latin", "meaning": "To look at, perceive, or observe.", "gloss": null}]
    }
  ]
}
```

- `text`:当前讲解(被审内容)。
- `etymologies`:该词全部词源分组,`etym_no` 最小的一组是主要来源。生成时**只讲主要来源**,
  但一条讲解如果能对上任何一组输入,也算有依据。
- 判断依据只有 `etymologies`(steps / text / morphemes)和词本身;**不要用自己的词源知识**去判对错。

## 输出

写到 `vocab-ai/review/etymology/NNNN.jsonl`,每行:

```json
{"word_id": 15840, "verdict": "ok", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 10078, "verdict": "fix", "reason": "讲的是同形动词 brook（容忍）的词源，与「小溪」义不符", "fix": {"text": "源自中古英语 brook，……"}, "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 2001, "verdict": "reject", "reason": "讲解与输入完全对不上，无法据输入改正", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
```

- `verdict`:`ok` / `fix` / `reject`。
- `reason`:不是 `ok` 时必填,一句话说明问题。
- `fix`:仅 `fix` 时填,是对该词讲解的**完整改正**,格式与原结果相同,即 `{"text": "<改正后的讲解>"}`。
  改正必须满足原生成要求(≤120 字、中文、全角标点、词形和语言名都来自输入、无阿拉伯数字),
  通过 `python -I scripts/vocab/ai_validate.py review-etymology --batch NNNN` 的原校验。
- `reviewer`、`review_version` 每行都要有。

`ok` 与 `fix` 入库后 `reviewed = 1`;`reject` 保持 `reviewed = 0`。

## 判据

1. **讲解内容要能在输入里找到依据**:出现的拉丁字母词形、语言、词义引申都来自 `etymologies`。
   出现输入里没有的词形、年代、本义或其他词义解释,判 `fix`(能改)或 `reject`(无从改起)。
2. **语言名要与输入对应**:输入是 Old French 才能写「古法语」,输入是 Proto-West Germanic
   才能写「原始西日耳曼语」;把现代英语写成中古英语这类阶段错位,判 `fix`。
3. **同形异源**:只讲主要来源(`etym_no` 最小)时,若该来源与 `word` 的常用义不是一回事
   (如 brook「小溪」讲成「容忍」的词源),判 `fix`。
   只有当输入里**确实**有另一组 `etym_no` 对应常用义时才能改;没有就 `reject`(并说明)。
4. **标点**:中文里出现半角 `,` `.` `;` `:` `(` `)` `!` `?` 判 `fix`(改成全角)。
5. **文不对题**:讲解空洞、没说词根含义、只是套话,判 `fix`。
6. 以下情况判 `ok`:文字稍别扭但意思对、依据齐;引申合理但表述可优化;拿不准的一律 `ok`。

## 自检清单

- [ ] 每行 `word_id` 与输入一一对应,行数一致。
- [ ] `reviewer` 为 `ai:opencode/glm-5.3-flash-free`,`review_version` 为 1。
- [ ] `fix` 的行都有 `reason`,且 `fix.text` 能通过原校验(≤120 字、全角标点、词形语言来自输入)。
- [ ] 没有为「风格更好」而改;拿不准的判了 `ok`。

## 流程

1. 读 `data/ai/input/review-etymology/NNNN.json`。
2. 写 `vocab-ai/review/etymology/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py review-etymology --batch NNNN`,按报错重写不合规的行。
4. 通过后进入下一批。

返回 [任务 5 全量审核](../../../docs/stage3-vocab-tasks.md)。
