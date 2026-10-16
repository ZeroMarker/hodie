"""阶段 3「AI 补全词库」任务的公共定义,供 ai_export.py、ai_validate.py 和 build.py 使用。

流程见 docs/stage3-vocab-tasks.md:ai_export.py 从 vocab.db 导出输入,opencode 逐批把结果
写进 vocab-ai/<任务>/NNNN.jsonl,ai_validate.py 按规则校验,build.py 只读取 vocab-ai/ 合并入库。
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "build" / "vocab.db"
AI = ROOT / "vocab-ai"  # AI 生成结果,入库
INPUT = ROOT / "data" / "ai" / "input"  # 导出给会话的输入,不入库
REVIEW = ROOT / "data" / "ai" / "review"  # 人工抽检导出,不入库
REVIEW_OUT = AI / "review"  # 任务 5 全量审核结果,入库

BATCH_SIZE = 100
# 生成要求版本,随每个任务单独维护;改动生成要求时提升,只重做受影响的批次。
# PROMPT_VERSION 是导出输入时写进文件的目标版本;PROMPT_VERSIONS 是校验时接受的版本集合,
# 允许同一任务的不同批次(或同一批次的不同行)保留旧版本结果,只重做受影响的词。
PROMPT_VERSION = {"examples": 3, "core_sense": 3, "collocations": 2, "etymology": 2}
PROMPT_VERSIONS = {
    "examples": {2, 3},
    "core_sense": {1, 2, 3},
    "collocations": {1, 2},
    "etymology": {1, 2},
}
# 入库行的 source 写 ai:opencode/<model>;结果文件里的 model 字段优先,缺省用这个
DEFAULT_MODEL = "deepseek-v4.1-flash"

# 任务 5:全量审核。审核模型与生成模型同属 DeepSeek V4.1 Flash,独立性有限,
# 结果记为 AI 审核(不写进 source,另记 reviewer 列)。
REVIEW_VERSION = 1
# ai_export.py / ai_validate.py 的 review-<任务> → 生成任务名;审核结果写 vocab-ai/review/<任务>/
REVIEW_TASKS = {
    "review-examples": "examples",
    "review-core_sense": "core_sense",
    "review-collocations": "collocations",
    "review-etymology": "etymology",
}
# 每个任务结果行里承载内容的字段名,审核的 fix 也用同名段给出改正后的完整内容
CONTENT_FIELD = {
    "examples": "examples",
    "core_sense": "core_sense_id",
    "collocations": "collocations",
    "etymology": "text",
}
REVIEW_VERDICTS = ("ok", "fix", "reject")

# ECDICT 释义的首行是核心义,行首是词性标记(如 n.、vt.)
POS_RE = re.compile(r"^([a-z]+\.)\s*")
# ECDICT 释义行首的词性标记 → WordNet 词性;无法对应的不校验词性
ECDICT_POS = {"n.": "n", "a.": "a", "vt.": "v", "vi.": "v", "v.": "v", "adv.": "r", "pl.": "n"}


def ecdict_positions(text):
    """ECDICT 释义各行行首词性标记对应的 WordNet 词性集合(不认识的行首不计入)。

    任务 2 校验从 prompt_version 3 起允许词性出现在任意一行,不再只认第一行。
    """
    positions = set()
    for line in (text or "").split("\n"):
        m = POS_RE.match(line.strip())
        if m and m.group(1) in ECDICT_POS:
            positions.add(ECDICT_POS[m.group(1)])
    return positions


def split_zh(text):
    """拆出 ECDICT 释义第一行(核心义)的内容和词性标记。"""
    line = (text or "").split("\n", 1)[0].strip()
    m = POS_RE.match(line)
    if m:
        return line[m.end():].strip() or None, m.group(1)
    return line or None, None


def result_path(task, batch):
    """结果文件路径,batch 从 1 开始。"""
    return AI / task / f"{batch:04d}.jsonl"


def read_jsonl(path):
    """逐行读 JSONL,跳过空行;返回 (记录, 报错信息列表)。"""
    records, errors = [], []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            errors.append(f"{path.name}:{lineno} {exc}")
    return records, errors


def covered(task, batch, word_ids):
    """结果文件是否存在且已包含这一批的全部 word_id。"""
    path = result_path(task, batch)
    if not path.exists():
        return False
    records, errors = read_jsonl(path)
    if errors:
        return False
    return set(word_ids) <= {r.get("word_id") for r in records}


def load_reviews(task):
    """读 vocab-ai/review/<task>/ 的审核结果:word_id → 审核行。

    返回 (reviews, errors);同一 word_id 后出现的行覆盖先前的。
    """
    reviews, errors = {}, []
    for path in sorted((REVIEW_OUT / task).glob("*.jsonl")):
        records, errs = read_jsonl(path)
        errors += errs
        for rec in records:
            wid = rec.get("word_id")
            if wid is not None:
                reviews[wid] = rec
    return reviews, errors


def load_reviews_for_all():
    """读四个任务的全部审核结果:(任务, word_id) → 审核行。

    不同任务的 word_id 可能重复(同一个词在例句、搭配等任务里都出现),
    所以用 (任务, word_id) 作键。返回 (reviews, errors)。
    """
    reviews, errors = {}, []
    for task in CONTENT_FIELD:
        task_reviews, errs = load_reviews(task)
        errors += errs
        for wid, rec in task_reviews.items():
            reviews[(task, wid)] = rec
    return reviews, errors

