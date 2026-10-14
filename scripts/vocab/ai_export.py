"""从 data/build/vocab.db 导出阶段 3 AI 补全任务的输入,每批 100 个词。

用法:
    python -I scripts/vocab/ai_export.py examples             # 导出全部批次
    python -I scripts/vocab/ai_export.py examples --batch 1   # 只导出第 1 批
    python -I scripts/vocab/ai_export.py examples --missing   # 只导出还没有结果的批次

写出 data/ai/input/<任务>/NNNN.json,格式见 vocab-ai/<任务>/PROMPT.md。
批次按 words.id 排序切分,词集不变时批次内容可复现,中断后按缺失的批次继续。
任务定义见 docs/stage3-vocab-tasks.md。
"""

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402

POS_RE = re.compile(r"^([a-z]+\.)\s*")

WORD_BOOK = "EXISTS (SELECT 1 FROM word_lists l WHERE l.word_id = w.id)"
# 目标集按 Tatoeba 等原始数据判断,不含 vocab-ai/ 已生成的例句,
# 这样合并入库后重新导出时批次不变,可从缺失的批次继续。
HAS_EXAMPLES = "EXISTS (SELECT 1 FROM examples e WHERE e.word_id = w.id AND e.source NOT LIKE 'ai:%')"


def split_zh(text):
    """ECDICT 释义的第一行是核心义,行首是词性标记(如 n.、vt.)。"""
    line = (text or "").split("\n", 1)[0].strip()
    m = POS_RE.match(line)
    if m:
        return line[m.end():].strip() or None, m.group(1)
    return line or None, None


def examples_words(db):
    """任务 1 例句的输入:没有例句的词书词,按 id 排序。"""
    rows = db.execute(
        f"SELECT w.id, w.word, w.translation_zh, w.cefr FROM words w"
        f" WHERE {WORD_BOOK} AND NOT {HAS_EXAMPLES} ORDER BY w.id"
    ).fetchall()
    collocations = {}
    for wid, phrase in db.execute("SELECT word_id, phrase FROM collocations ORDER BY word_id, log_dice DESC"):
        collocations.setdefault(wid, []).append(phrase)
    words = []
    for wid, word, zh, cefr in rows:
        core, pos = split_zh(zh)
        item = {"word_id": wid, "word": word, "zh": core, "pos": pos, "cefr": cefr}
        if collocations.get(wid):
            item["collocations"] = collocations[wid]
        words.append(item)
    return words


TASKS = {"examples": examples_words}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("task", choices=sorted(TASKS), help="任务名,如 examples")
    parser.add_argument("--batch", type=int, help="只导出这个批次(从 1 开始)")
    parser.add_argument("--missing", action="store_true", help="只导出还没有结果的批次")
    args = parser.parse_args()

    db = sqlite3.connect(ai.DB)
    words = TASKS[args.task](db)
    total = (len(words) + ai.BATCH_SIZE - 1) // ai.BATCH_SIZE
    if args.batch and not 1 <= args.batch <= total:
        parser.error(f"批次超出范围:1 到 {total}")

    out = ai.INPUT / args.task
    out.mkdir(parents=True, exist_ok=True)
    written = 0
    for i in range(total):
        batch = words[i * ai.BATCH_SIZE:(i + 1) * ai.BATCH_SIZE]
        if args.batch and i + 1 != args.batch:
            continue
        if args.missing and ai.covered(args.task, i + 1, {w["word_id"] for w in batch}):
            continue
        data = {
            "task": args.task,
            "prompt_version": ai.PROMPT_VERSION[args.task],
            "batch": f"{i + 1:04d}",
            "total_batches": total,
            "words": batch,
        }
        path = out / f"{i + 1:04d}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written += 1
    print(f"{args.task}: 输入 {len(words)} 词共 {total} 批,写出 {written} 个批次文件到 {out}")


if __name__ == "__main__":
    main()
