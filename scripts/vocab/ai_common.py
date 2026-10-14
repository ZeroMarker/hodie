"""阶段 3「AI 补全词库」任务的公共定义,供 ai_export.py、ai_validate.py 和 build.py 使用。

流程见 docs/stage3-vocab-tasks.md:ai_export.py 从 vocab.db 导出输入,opencode 逐批把结果
写进 vocab-ai/<任务>/NNNN.jsonl,ai_validate.py 按规则校验,build.py 只读取 vocab-ai/ 合并入库。
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "build" / "vocab.db"
AI = ROOT / "vocab-ai"  # AI 生成结果,入库
INPUT = ROOT / "data" / "ai" / "input"  # 导出给会话的输入,不入库
REVIEW = ROOT / "data" / "ai" / "review"  # 人工抽检导出,不入库

BATCH_SIZE = 100
# 生成要求版本,随每个任务单独维护;改动生成要求时提升,只重做受影响的批次
PROMPT_VERSION = {"examples": 1}
# 入库行的 source 写 ai:opencode/<model>;结果文件里的 model 字段优先,缺省用这个
DEFAULT_MODEL = "deepseek-v4.1-flash"


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
