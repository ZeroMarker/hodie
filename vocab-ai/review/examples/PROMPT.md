# 任务 5:全量审核 · 例句

本文件是 `vocab-ai/review/examples/` 的审核标准,每批审核前重读一遍。
被审对象是 `vocab-ai/examples/` 的生成结果,审核模型为 `opencode/minimax-m3.1-flash-free`,
结果记为 **AI 审核**(与人工审核区分)。任务定义见 [阶段 3 词库任务](../../../docs/stage3-vocab-tasks.md)。
批次 0001-0062 和 0065 由 `opencode/glm-5.3-flash-free` 审核(0065 是上一段工作中断时留下的文件,校验通过后保留),
0063、0064、0066 起由 `opencode/minimax-m3.1-flash-free` 审核;每行 `reviewer` 记录**实际**审核模型。

- `review_version`:**1**
- `reviewer`:`ai:opencode/minimax-m3.1-flash-free`(批次 0001-0062 和 0065 为 `ai:opencode/glm-5.3-flash-free`)
- 输出:`vocab-ai/review/examples/NNNN.jsonl`,每行一个词,与输入 `word_id` 一一对应

## 做什么

逐条检查每词的 2 条中英例句是否中英相符、是否用了 `zh` 给出的核心义、英文是否自然、中文是否准确。
**拿不准就判 `ok`,不要过度修改。**

## 输入

`data/ai/input/review-examples/NNNN.json`,每批 100 词,每词:

```json
{
  "word_id": 25,
  "word": "abandonment",
  "zh": "放弃, 抛弃, 放纵",
  "pos": "n.",
  "cefr": null,
  "collocations": ["abandonment issues", "fear of abandonment"],
  "examples": [
    {"text_en": "He still struggles with abandonment issues.", "text_zh": "他仍然难以摆脱被遗弃的阴影。"},
    {"text_en": "The child's fear of abandonment is understandable.", "text_zh": "这孩子对被遗弃的恐惧是可以理解的。"}
  ],
  "prompt_version": 2
}
```

- `examples`:当前结果(被审内容),每词 2 条。
- `zh`、`pos`、`collocations` 是判断依据;`zh` 是第一行核心义。

## 输出

写到 `vocab-ai/review/examples/NNNN.jsonl`,每行:

```json
{"word_id": 25, "verdict": "ok", "reviewer": "ai:opencode/minimax-m3.1-flash-free", "review_version": 1}
{"word_id": 1001, "verdict": "fix", "reason": "中文译成「复制品」，与 representation 的核心义「代表/表现」不符", "fix": {"examples": [{"text_en": "...", "text_zh": "..."}, {"text_en": "...", "text_zh": "..."}]}, "reviewer": "ai:opencode/minimax-m3.1-flash-free", "review_version": 1}
{"word_id": 2002, "verdict": "reject", "reason": "两条英文都用错义项且无法据输入改正", "reviewer": "ai:opencode/minimax-m3.1-flash-free", "review_version": 1}
```

- `verdict`:`ok` / `fix` / `reject`。
- `reason`:不是 `ok` 时必填,一句话说明问题。
- `fix`:仅 `fix` 时填,是该词**两条例句的完整改正**,格式与原结果相同,即
  `{"examples": [{"text_en": "...", "text_zh": "..."}, {"text_en": "...", "text_zh": "..."}]}`。
  改正必须满足原生成要求(每条英文 6 到 14 词、含目标词或其变化形式、中文非空且不含英文目标词、
  中文全角标点、不用 old/whole 凑词、不用 do 强调式),通过
  `python -I scripts/vocab/ai_validate.py review-examples --batch NNNN` 的原校验。
- `reviewer`、`review_version` 每行都要有。

`ok` 与 `fix` 入库后 `reviewed = 1`;`reject` 保持 `reviewed = 0`。

## 判据

1. **中英是否相符**:中文是英文的准确翻译,没有误译、错译(如把 representation 译成「复制品」)。
   不符判 `fix`(能改)或 `reject`(无从改起)。
2. **是否用了 `zh` 的核心义**:英文句子里目标词必须是 `zh` 给的那个义项,不能是别的义项
   (如 definitive 用作语法术语、farming 用作「小区」)。用错义项判 `fix`。
3. **英文是否语法正确、自然通顺**;有语法错误、明显别扭、语义自相矛盾(如 destructible 的句子
   说「破坏不了」)判 `fix`。
4. **中文用词是否准确、得体**;译名或释义与英文不符判 `fix`。
5. **风格问题不单独判错**:句式偏简单、用词偏常见属于原生成要求的取舍,只要通顺、正确就判 `ok`;
   但两条句子几乎一模一样、只换一个人称,或中文含英文目标词,判 `fix`。
6. 拿不准的一律 `ok`。

## 自检清单

- [ ] 每行 `word_id` 与输入一一对应,行数一致。
- [ ] `reviewer` 为 `ai:opencode/minimax-m3.1-flash-free`(批次 0001-0062 和 0065 为 `ai:opencode/glm-5.3-flash-free`),`review_version` 为 1。
- [ ] `fix` 的行都有 `reason`,`fix.examples` 恰好 2 条,能通过原校验(词数、含目标词、中文全角标点等)。
- [ ] 没有为「句式更好」这类风格问题而改;拿不准的判了 `ok`。

## 流程

1. 读 `data/ai/input/review-examples/NNNN.json`。
2. 写 `vocab-ai/review/examples/NNNN.jsonl`。
3. `python -I scripts/vocab/ai_validate.py review-examples --batch NNNN`,按报错重写不合规的行。
4. 通过后进入下一批。

返回 [任务 5 全量审核](../../../docs/stage3-vocab-tasks.md)。
