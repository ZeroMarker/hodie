# 阶段 3 词库任务(交给 opencode)

2026-10-14

阶段 1 到 2 中不依赖 AI 的词库工作已完成(见 [scripts/vocab](../scripts/vocab/README.md))。本文列出阶段 3 中需要用 LLM 补齐的词库数据,交给 opencode 实施。学习功能本身(AI 对话、造句批改)不在本文范围内。

## 现状

「词书词」指出现在 `word_lists` 中的词,共 14986 个,是学习队列的全部来源。

| 数据 | 词书词覆盖 | 缺口 |
| --- | --- | --- |
| 中英例句(`examples`,Tatoeba + AI) | 14986 | 0(任务 1 已完成;AI 例句 `reviewed` 待人工抽检后置 1) |
| 搭配(`collocations`,Tatoeba logDice 统计 + AI) | 14986 | 0(任务 3 已完成:87 批、8639 词、18855 条 AI 搭配,见改进记录;Tatoeba 搭配按原形合并时态重复后为 23328 条;`reviewed` 待人工抽检) |
| WordNet 词义(`senses`) | 14330 | 0(任务 2 已完成并二次改进:10105 个多义词按现代英语最常用义确定核心义,10073 个有 `core_sense_id`,32 个无法判断为 NULL,见改进记录;`reviewed` 待人工抽检) |
| 词源中文讲解(`etymology_notes`,基于 `etymology_steps`) | 10489 | 0(任务 4 已完成:105 批、10489 词,校验 10489/10489 通过;`reviewed` 待人工抽检) |

## 通用约定

所有任务都遵守以下约定,保证可复现、可审核、成本可控。

1. **由 opencode 直接生成**:不写逐词调用 LLM API 的脚本,内容由 opencode 会话本身按批写出。流程:
    - `scripts/vocab/ai_export.py <任务>` 从 `vocab.db` 导出输入,每批 100 个词,写到 `data/ai/input/<任务>/0001.json`;
    - opencode 逐批读取输入,把结果写到 `vocab-ai/<任务>/0001.jsonl`,每行一个词,带 `word_id` 和 `prompt_version`;
    - `scripts/vocab/ai_validate.py <任务>` 按各任务的规则校验,输出通过率和不通过的 `word_id`,不通过的重新生成;
    - `build.py` 只读取 `vocab-ai/` 合并入库。
2. **结果入库**:`vocab-ai/` 提交到仓库(和 `data/` 不同),生成成本只付一次;每完成若干批就提交一次,中断后从缺失的批次继续。修改生成要求时提升 `prompt_version`,只重做受影响的批次。
3. **生成要求写进仓库**:每个任务的生成要求写在 `vocab-ai/<任务>/PROMPT.md`,每批生成前都重读一遍,保证不同会话之间标准一致。
4. **校验**:每个任务都要有程序校验(规则见各任务),不通过的结果丢弃或重试,不入库。
5. **来源标记**:入库行的 `source` 写 `ai:opencode/<model>`,并加 `reviewed`(0 或 1)列。应用只展示 `reviewed = 1` 的数据,或在界面上标出「AI 生成」;这一点由产品决定,先两种都支持。
6. **人工抽检**:每个任务随机抽 200 条导出为 `data/ai/review/<任务>.csv`,供人工检查。抽检错误率低于 5% 时,整批标为 `reviewed = 1`。
7. **试跑**:每个任务先做 1 批,运行校验并人工看 20 条,确认质量后再做全量。
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

- **输入**:词、ECDICT 中文释义全文(词性可出现在任意一行)、该词全部 `senses`(id、词性、英文释义)。
- **输出**:`core_sense_id`,必须是输入里给出的 sense id 之一;无法判断时输出 null。选词以「现代英语中最常用的义项」为准,不受释义行顺序限制。
- **入库**:`words` 增加 `core_sense_id` 列。
- **校验**:输出的 id 必须属于该词;所选词义的词性要出现在 ECDICT 释义的任意一行(如 `n.` 对应 n,`vt.` 和 `vi.` 对应 v),不要求与第一行一致。

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
- **完成情况(2026-10-15)**:105 批、10489 词全部生成,`ai_validate.py` 校验 10489/10489 通过(100%,`prompt_version=1`),最长讲解 116 字。第 1、22 批由 deepseek-v4-pro 生成,其余用 deepseek-v4.1-flash。`reviewed` 仍为 0,待人工抽检(`data/ai/review/etymology.csv` 200 条)。

## 抽检结果

2026-10-15 由 Claude 逐条审阅 `data/ai/review/` 下的抽检样本(每个任务随机 200 条;核心义的旧样本只有试跑批次,已重新从全量随机抽取)。这是 AI 审阅,不是人工审阅;是否据此把 `reviewed` 置 1,由产品负责人决定。

| 任务 | 明确错误 | 错误率 | 错误示例 | 系统性问题 |
| --- | --- | --- | --- | --- |
| 1 例句 | 9 | 4.5% | definitive 误用为语法术语;farming 的「小区」误译;loutish、squelch 中文与英文不符 | 句式单调:old、whole、「They did …」强调式大量出现 |
| 2 核心义 | 2 | 1.0% | colossus 选成「巨人」而非「巨像」;sacrifice 选成「因过失而失去」 | 照搬 ECDICT 首项,冷僻义排前时选到冷僻义(settle→高背长椅、bound→跳跃) |
| 3 搭配 | 2 | 1.0% | anodyne remark 译成「安抚人心的话」;glamour model 译成「艳星」 | 功能词搭配(by the way、with him、where else)学习价值低 |
| 4 词源讲解 | 6 | 3.0% | confer、Greek 把早期现代英语/古英语写成中古英语;wary 混入同形词 warien(诅咒)的词源;switch 混淆细枝与转辙轨;arrogance、conformity 给出输入中没有的「本义」 | 常补充输入中没有的词义解释(多数正确但无依据);全角、半角标点混用 |

四个任务的错误率都低于 5% 的门槛。建议:

1. 例句提升 `prompt_version`,要求用词多样、禁止无意义的 do 强调式,只重做命中这些模式的句子。
2. 核心义改为「最常用的义项」而非「ECDICT 第一项」,作为任务 2 的第 2 版。
3. 词源讲解的校验增加一条:讲解中出现的语言名(中古英语、古英语等)必须出现在输入里;标点统一为全角。
4. 抽检发现的具体错误在对应 jsonl 中直接改正。

## 改进记录

2026-10-15 按上述建议改进阶段 3 数据。沿用 `ai_export`/`ai_validate`/`build` 流程,生成全部用 `deepseek-v4.1-flash`。

### 1 例句 · prompt_version 3

- `ai_validate.py` 新增两条规则:句中用 `old` 或 `whole` 凑词(目标词本身除外),或出现 `do/does/did` 后紧跟原形动词的强调式,即不通过。
- 只重做命中规则的 3697 个词,其余 4164 个词保留 v2 结果;校验按每行自身的 `prompt_version` 承接,并统一套用新规则。
- 另改正抽检发现的 6 个词:definitive(改用「决定性的/权威的」义,不再用语法术语)、loutish、squelch(中文与英文不符)、bravura、urbanism、melodrama;farming、bathetic、distention 已由重做覆盖。
- 结果:`prompt_version=3` 3702 词、`prompt_version=2` 4164 词,校验 7866/7866 通过(100%)。

### 2 核心义 · prompt_version 2

- 判断标准由「ECDICT 第一行」改为「该词在现代英语中最常用的义项」,参考 ECDICT 全部释义,冷僻、古旧、专业义项排前时不选。
- 全量重做 102 批、10105 词:`prompt_version=2`,9970 词(98.7%)给出核心义词义,135 词(1.3%)写 NULL(colossus 因 WordNet 无「巨像」义写 NULL;sacrifice 改选「献祭/祭品」义)。
- 与 v1 相比,1463 词(14.5%)选择不同。
- 校验 10105/10105 通过(100%)。

### 2 核心义 · prompt_version 3(二次改进)

- 问题:v2 的校验仍要求所选词义的词性和 ECDICT **第一行**一致,第一行是冷僻词性的词选不到常用义(settle 首行「有背长椅」→ NULL、fine 只能选名词「罚款」、meet 只能选名词「运动会」)。
- `ai_validate.py` 的词性规则放宽为「词性出现在 ECDICT 释义的任意一行即可」;`ai_export.py` 的输入改为给出 `zh` 全文和 `positions`(释义里出现过的词性),不再把第一行词性单列成 `pos`。
- `vocab-ai/core_sense/PROMPT.md` 升到 `prompt_version 3`,写明优先选现代英语最常用的义项,不受释义行顺序和第一行词性限制。
- 只重做受影响的 4063 个词:词书多义词、ECDICT 释义含多个词性,且当前结果为空或所选词性等于第一行词性(含「所选词性只出现在第一行、而其他行还有别的词性」)。用新增的 `scripts/vocab/core_sense_redo.py` 检测并导出重做输入(`--export`/`--check`/`--merge`),其余 6042 词保留 v2;校验按每行自身的 `prompt_version` 承接。
- 结果:`prompt_version=3` 4063 词、`prompt_version=2` 6042 词;与 v2 相比 1340 词(33%,占全体 13.3%)改选,其中 1036 词换了词性(主要为 n→v 539、n→a 269);104 个重做词里的 NULL 有 103 个给出义项,`core_sense_id` 非空从 9970 升到 10073(99.7%),NULL 从 135 降到 32。
- 校验 10105/10105 通过(100%)。
- 抽查(2026-10-15):settle `oewn-settle__2.31.00..`(解决义,原 NULL)、fine `oewn-fine__5.00.00.satisfactory.00`(好的,原名词罚款)、meet `oewn-meet__2.41.01..`(会面,原名词运动会)、kernel 不变(核心);bound 仍选名词「界限」(`oewn-bound__1.15.00..`),未选冷僻的「跳跃」义;colossus 仍写 NULL(WordNet 无「巨像」义)。

### 3 搭配

- 删除目标词是功能词、搭配其余词也都是功能词或泛化名词的低价值搭配 146 条,涉及 82 个词,其中 36 个词清空;AI 搭配从 19001 条降为 18855 条(8603 词)。校验放宽为允许 0 条。
- 改正 anodyne remark(→无关痛痒的话)、glamour model(→性感模特)。
- 校验 8639/8639 通过(100%)。

### 4 词源讲解 · prompt_version 2

- 先机械地把现有讲解中的半角标点转成全角(共 9092 条,不经 LLM);`ai_validate.py` 新增两条规则:讲解里出现的语言名必须与输入的语言对应;中文里不得出现半角标点 `, . ; : ( ) ! ?`。
- 再重做 19 个词:14 个语言名与输入不符(confer、accolade、fuse、hunt、jubilation、pencil、perjure、propriety、reckon、slimy、starch、still、stove、weeds,按输入改为早期现代英语/奥克语/意大利语/原始西日耳曼语等),另改正 Greek、wary(去掉 warien 诅咒一说)、switch(不混淆细枝与转辙轨)、arrogance、conformity(删去输入中没有的本义)。
- 结果:`prompt_version=2` 19 词、`prompt_version=1` 10470 词(仅机械改标点),校验 10489/10489 通过(100%)。

### 结果

- 重新构建 `data/build/vocab.db`;重新导出四份人工抽检 CSV(`--review 200`:`data/ai/review/{examples,core_sense,collocations,etymology}.csv`)。
- 四个任务在本轮的校验通过率都是 100%。本轮未运行 `load_pg.py`,线上 `vocab` schema 仍是上一版;`reviewed` 全部仍为 0,待人工抽检后统一导入。
- 2026-10-15 核心义二次改进后再次运行 `build.py` 重建 `data/build/vocab.db`(core_sense 10073 词),并重新导出 `data/ai/review/core_sense.csv`;本轮同样未运行 `load_pg.py`。

## 交付

- 每个任务单独提交,提交说明写明生成条数、校验通过率、抽检结果和实际费用。
- 更新 `scripts/vocab/README.md` 的构建结果,以及本文的「现状」表。
- 重新构建后,运行 `load_pg.py` 更新线上 `vocab` schema(连接方式见 README)。

返回 [开发计划](plan.md)。
