# 任务 5:全量审核 · 搭配

本文件是 `vocab-ai/review/collocations/` 的审核标准,每批审核前重读一遍。
被审对象是 `vocab-ai/collocations/` 的生成结果,审核模型为 `opencode/glm-5.3-flash-free`,
结果记为 **AI 审核**(与人工审核区分)。任务定义见 [阶段 3 词库任务](../../../docs/stage3-vocab-tasks.md)。

- `review_version`:**1**
- `reviewer`:`ai:opencode/glm-5.3-flash-free`
- 输出:`vocab-ai/review/collocations/NNNN.jsonl`,每行一个词,与输入 `word_id` 一一对应

## 做什么

逐条检查每词的搭配是否真实常见、地道,中文释义是否准确,有没有功能词低价值搭配或拼凑的组合。
**拿不准就判 `ok`,不要过度修改。**

## 输入

`data/ai/input/review-collocations/NNNN.json`,每批 100 词,每词:

```json
{
  "word_id": 26,
  "word": "abase",
  "zh": "贬低, 降低",
  "pos": "vt.",
  "cefr": null,
  "collocations": [
    {"phrase": "abase oneself", "partner": "oneself", "zh": "贬低自己"},
    {"phrase": "abase oneself before", "partner": "before", "zh": "在…面前自贬"}
  ],
  "prompt_version": 2
}
```

- `collocations`:当前结果(被审内容),每词 0 到 3 条;功能词目标词可能为空数组 `[]`。
- `zh`、`pos`、`cefr` 是判断依据。

## 输出

写到 `vocab-ai/review/collocations/NNNN.jsonl`,每行:

```json
{"word_id": 26, "verdict": "ok", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 1002, "verdict": "fix", "reason": "i.e. 的两条是伪搭配，无学习价值", "fix": {"collocations": []}, "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
{"word_id": 2003, "verdict": "reject", "reason": "三条搭配都不成立，无法据输入改正", "reviewer": "ai:opencode/glm-5.3-flash-free", "review_version": 1}
```

- `verdict`:`ok` / `fix` / `reject`。
- `reason`:不是 `ok` 时必填,一句话说明问题。
- `fix`:仅 `fix` 时填,是该词**搭配的完整改正**,格式与原结果相同,即
  `{"collocations": [{"phrase": "...", "partner": "...", "zh": "..."}]}`(删光时写 `{"collocations": []}`)。
  改正必须通过 `python -I scripts/vocab/ai_validate.py review-collocations --batch NNNN` 的原校验:
  0 到 3 条、`phrase` 含目标词或其变化形式、`partner` 是单个原形且能在词库找到、`partner` 出现在 `phrase` 里、
  同一词 `partner` 和 `phrase` 不重复、每条有中文释义。
- `reviewer`、`review_version` 每行都要有。

`ok` 与 `fix` 入库后 `reviewed = 1`;`reject` 保持 `reviewed = 0`。

## 判据

1. **搭配是否真实常见、地道**:编造、生硬或语义不通的组合判 `fix`(能改)或 `reject`(无从改起)。
2. **中文释义是否准确**:译错(如 anodyne remark 译成「安抚人心的话」、glamour model 译成「艳星」)判 `fix`。
3. **功能词低价值搭配**:目标词是介词、代词、连词、限定词、助动词等,而搭配几乎全是功能词
   (by the way、with him、where else 类),判 `fix`,直接删掉这些条目(必要时整个清空)。
4. **伪搭配**:目标词本身是缩写或非实词,搭配无意义(如 i.e. 的条目),判 `fix` 删除。
5. 以下判 `ok`:搭配略少见但成立;排在后面的条目不如第一条常用;释义措辞可优化但意思对。
   拿不准的一律 `ok`。

## 自检清单

- [ ] 每行 `word_id` 与输入一一对应,行数一致。
- [ ] `reviewer` 为 `ai:opencode/glm-5.3-flash-free`,`review_version` 为 1。
- [ ] `fix` 的行都有 `reason`,`fix.collocations` 0 到 3 条,能通过原校验。
- [ ] 没有为「还能有更好的搭配」而改;拿不准的判了 `ok`。

## 流程

1. 读 `data/ai/input/review-collocations/NNNN.json`。
2. 写 `vocab-ai/review/collocations/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py review-collocations --batch NNNN`,按报错重写不合规的行。
4. 通过后进入下一批。

返回 [任务 5 全量审核](../../../docs/stage3-vocab-tasks.md)。
