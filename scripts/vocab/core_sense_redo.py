"""找出任务 2(核心义)第 3 版需要重做的词,并导出重做输入。

背景见 docs/stage3-vocab-tasks.md 的改进记录:第 2 版校验要求所选词义词性
和 ECDICT 释义**第一行**一致,导致 settle、fine、meet 这类常用义在别的词性的词
只能选冷僻义或写 NULL。第 3 版把校验放宽为「词性出现在任意一行即可」,只需重做
被第一行词性限制过的词。

受影响的词(以下三个条件同时满足):
    1. 是词书词、有多于一个 WordNet 词义;
    2. ECDICT 释义含多个词性(>= 2 个不同 WordNet 词性);
    3. 当前结果为空,或所选词义的词性等于第一行词性(旧校验据此把选择限制在
       第一行的词性;常用义若是别的词性就选不到)。
第 3 条的第二个分支覆盖了任务里说的「当前选择的词性只出现在第一行、而其他行
还有别的词性」的情形,同时把第一行词性虽在后面重复、但常用义仍可能在其他
词性的词也一并覆盖。

当前结果从 vocab-ai/core_sense/*.jsonl 读取(即上一版结果),所以脚本要在
覆盖结果文件之前运行。

用法:
    python -I scripts/vocab/core_sense_redo.py                   # 打印统计,不写文件
    python -I scripts/vocab/core_sense_redo.py --export          # 导出重做输入
    python -I scripts/vocab/core_sense_redo.py --export --chunk 100
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402

# WordNet 的形容词卫星词义(s)按形容词(a)处理,与 ai_validate.py 一致
SENSE_POS = {"s": "a"}


def load_current():
    """从 vocab-ai/core_sense/ 读取当前 core_sense_id:word_id → id 或 None。"""
    current = {}
    for path in sorted((ai.AI / "core_sense").glob("*.jsonl")):
        records, errors = ai.read_jsonl(path)
        for error in errors:
            print(f"解析失败 {error}", file=sys.stderr)
        for rec in records:
            current[rec.get("word_id")] = rec.get("core_sense_id")
    return current


def load_words(db):
    """词书多义词:word_id → (word, zh, 首行词性, 全行词性集合, senses)。"""
    senses = {}
    for wid, sid, pos, definition in db.execute(
        "SELECT word_id, id, pos, definition FROM senses"
    ):
        senses.setdefault(wid, {})[sid] = (pos, definition)
    rows = db.execute(
        "SELECT w.id, w.word, w.translation_zh FROM words w"
        " WHERE EXISTS (SELECT 1 FROM word_lists l WHERE l.word_id = w.id)"
        " AND (SELECT count(*) FROM senses s WHERE s.word_id = w.id) > 1 ORDER BY w.id"
    ).fetchall()
    words = {}
    for wid, word, zh in rows:
        first = ai.ecdict_positions((zh or "").split("\n", 1)[0])
        words[wid] = {
            "word": word,
            "zh": zh,
            "first_pos": next(iter(first), None),
            "positions": ai.ecdict_positions(zh),
            "senses": senses.get(wid, {}),
        }
    return words


def affected(words, current):
    """返回受影响词的列表:(word_id, 当前 id, 是否 NULL, 首行词性, 所选词性)。"""
    result = []
    for wid, entry in words.items():
        if len(entry["positions"]) < 2:
            continue  # 释义只有一种词性,第一行词性限制不影响选择
        sid = current.get(wid)
        if sid is None:
            result.append((wid, None, True, entry["first_pos"], None))
            continue
        sense = entry["senses"].get(sid)
        if sense is None:
            continue
        got = SENSE_POS.get(sense[0], sense[0])
        if entry["first_pos"] is not None and got == entry["first_pos"]:
            result.append((wid, sid, False, entry["first_pos"], got))
    return result


def check_exports():
    """校验 data/ai/redo/core_sense/out/ 的全部结果:覆盖完整、词性规则、id 属于该词。"""
    import ai_validate  # 复用任务 2 的校验规则

    db = sqlite3.connect(ai.DB)
    ctx = ai_validate.load_context("core_sense", db)
    versions = ai.PROMPT_VERSIONS["core_sense"]
    out_dir = ai.ROOT / "data" / "ai" / "redo" / "core_sense" / "out"
    in_dir = ai.ROOT / "data" / "ai" / "redo" / "core_sense" / "in"
    total = failed = 0
    for path in sorted(out_dir.glob("*.jsonl")):
        records, errors = ai.read_jsonl(path)
        for error in errors:
            print(f"解析失败 {error}")
        expected = set()
        src = in_dir / f"{path.stem}.json"
        if src.exists():
            expected = {w["word_id"] for w in json.loads(src.read_text(encoding="utf-8"))["words"]}
        got = [r.get("word_id") for r in records]
        if expected and set(got) != expected:
            print(f"{path.name}: word_id 不匹配,缺 {sorted(expected - set(got))[:5]},多 {sorted(set(got) - expected)[:5]}")
        for rec in records:
            total += 1
            reasons, _ = ai_validate.check_core_sense_record(rec, ctx, versions)
            if reasons:
                failed += 1
                entry = ctx["words"].get(rec.get("word_id"), {})
                print(f"不通过 {rec.get('word_id')} {entry.get('word', '?')}: {' ; '.join(reasons)}")
    print(f"校验重做结果 {total} 行,不通过 {failed} 个")
    return failed


def merge_exports():
    """把 data/ai/redo/core_sense/out/ 的 v3 结果替换进 vocab-ai/core_sense/*.jsonl。

    其余词的行原样保留 v2;批次文件行数不变。
    """
    out_dir = ai.ROOT / "data" / "ai" / "redo" / "core_sense" / "out"
    new = {}
    for path in sorted(out_dir.glob("*.jsonl")):
        records, errors = ai.read_jsonl(path)
        for error in errors:
            print(f"解析失败 {error}")
        for rec in records:
            new[rec["word_id"]] = rec
    total = replaced = 0
    for path in sorted((ai.AI / "core_sense").glob("*.jsonl")):
        lines = []
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            rec = json.loads(raw)
            total += 1
            if rec["word_id"] in new:
                rec = new[rec["word_id"]]
                replaced += 1
            lines.append(json.dumps(rec, ensure_ascii=False))
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"合并 {replaced} 个 v3 结果进 vocab-ai/core_sense/,共 {total} 行")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--export", action="store_true", help="导出重做输入到 data/ai/redo/core_sense/in/")
    parser.add_argument("--check", action="store_true", help="校验 data/ai/redo/core_sense/out/ 的重做结果")
    parser.add_argument("--merge", action="store_true", help="把 out/ 的 v3 结果合并进 vocab-ai/core_sense/")
    parser.add_argument("--chunk", type=int, default=100, help="每个重做输入文件的词数,默认 100")
    args = parser.parse_args()

    if args.check:
        sys.exit(1 if check_exports() else 0)
    if args.merge:
        merge_exports()
        return

    db = sqlite3.connect(ai.DB)
    words = load_words(db)
    rows = affected(words, load_current())
    nulls = sum(1 for r in rows if r[2])
    print(f"多义词书词 {len(words)} 个,受影响需重做 {len(rows)} 个(其中当前为 NULL {nulls} 个)")
    by_pos = {}
    for _, _, _, first, got in rows:
        by_pos[(first, got)] = by_pos.get((first, got), 0) + 1
    top = sorted(by_pos.items(), key=lambda kv: -kv[1])[:8]
    print("首行词性 → 所选词性 最多的组合:", ", ".join(f"{f}→{g}:{n}" for (f, g), n in top))
    print("例如:", ", ".join(f"{words[w]['word']}({s or 'NULL'})" for w, s, *_ in rows[:20]))

    if not args.export:
        return
    # 重做输入沿用 ai_export 导出的完整输入,只挑受影响词;按 id 排序切块
    records = {}
    for path in sorted((ai.INPUT / "core_sense").glob("*.json")):
        for item in json.loads(path.read_text(encoding="utf-8"))["words"]:
            records[item["word_id"]] = item
    out = ai.ROOT / "data" / "ai" / "redo" / "core_sense" / "in"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    ids = sorted(w for w, *_ in rows)
    chunks = 0
    for i in range(0, len(ids), args.chunk):
        chunk = ids[i:i + args.chunk]
        data = {
            "task": "core_sense",
            "prompt_version": ai.PROMPT_VERSION["core_sense"],
            "chunk": f"{i // args.chunk + 1:04d}",
            "total_chunks": (len(ids) + args.chunk - 1) // args.chunk,
            "words": [records[w] for w in chunk],
        }
        (out / f"{i // args.chunk + 1:04d}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        chunks += 1
    print(f"导出 {len(ids)} 个词、{chunks} 个重做输入文件到 {out}")


if __name__ == "__main__":
    main()
