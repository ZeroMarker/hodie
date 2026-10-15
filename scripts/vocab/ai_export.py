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
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402

WORD_BOOK = "EXISTS (SELECT 1 FROM word_lists l WHERE l.word_id = w.id)"
# 目标集按 Tatoeba 等原始数据判断,不含 vocab-ai/ 已生成的例句,
# 这样合并入库后重新导出时批次不变,可从缺失的批次继续。
HAS_EXAMPLES = "EXISTS (SELECT 1 FROM examples e WHERE e.word_id = w.id AND e.source NOT LIKE 'ai:%')"
HAS_COLLOCATIONS = "EXISTS (SELECT 1 FROM collocations c WHERE c.word_id = w.id AND c.source NOT LIKE 'ai:%')"
HAS_STEPS = "EXISTS (SELECT 1 FROM etymology_steps s WHERE s.word_id = w.id)"


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
        core, pos = ai.split_zh(zh)
        item = {"word_id": wid, "word": word, "zh": core, "pos": pos, "cefr": cefr}
        if collocations.get(wid):
            item["collocations"] = collocations[wid]
        words.append(item)
    return words


def core_sense_words(db):
    """任务 2 核心义对应 WordNet 词义的输入:有多于一个 WordNet 词义的多义词书词,按 id 排序。

    提供 ECDICT 释义全文(含多行,词性可以出现在任意一行)和该词全部词义
    (id、词性、英文释义),让模型判断该词在现代英语中最常用的义项对应哪个词义。
    `positions` 是释义里出现过的 WordNet 词性,供参考;不必局限于第一行。
    """
    rows = db.execute(
        f"SELECT w.id, w.word, w.translation_zh FROM words w"
        f" WHERE {WORD_BOOK}"
        f" AND (SELECT count(*) FROM senses s WHERE s.word_id = w.id) > 1 ORDER BY w.id"
    ).fetchall()
    senses = {}
    for wid, sid, pos, definition in db.execute(
        "SELECT word_id, id, pos, definition FROM senses ORDER BY word_id, sense_order"
    ):
        senses.setdefault(wid, []).append({"id": sid, "pos": pos, "def": definition})
    words = []
    for wid, word, zh in rows:
        words.append({
            "word_id": wid,
            "word": word,
            "zh": zh,
            "positions": sorted(ai.ecdict_positions(zh)),
            "senses": senses[wid],
        })
    return words


def collocations_words(db):
    """任务 3 搭配的输入:没有搭配的词书词,按 id 排序。

    给核心义、词性和 exchange(词形变化),让模型写出真实的常见搭配。
    """
    rows = db.execute(
        f"SELECT w.id, w.word, w.translation_zh, w.cefr, w.exchange FROM words w"
        f" WHERE {WORD_BOOK} AND NOT {HAS_COLLOCATIONS} ORDER BY w.id"
    ).fetchall()
    words = []
    for wid, word, zh, cefr, exchange in rows:
        core, pos = ai.split_zh(zh)
        item = {"word_id": wid, "word": word, "zh": core, "pos": pos, "cefr": cefr}
        if exchange:
            item["exchange"] = exchange
        words.append(item)
    return words


def etymology_words(db):
    """任务 4 词源讲解的输入:有来源链的词书词,按 id 排序。

    只提供库里的词源三件套:来源链、词源说明全文、构词拆分(含语素原义),
    语言代码转成 Wiktionary 里的英文名。一词多源的按 etym_no 分组,便于只讲主要来源。
    """
    langs = dict(db.execute("SELECT code, name FROM languages"))
    groups = defaultdict(lambda: defaultdict(lambda: {"steps": [], "morphemes": [], "text": None}))
    for wid, no, type_, lang, term, gloss in db.execute(
        "SELECT word_id, etym_no, type, lang, term, gloss FROM etymology_steps ORDER BY word_id, etym_no, step"
    ):
        groups[wid][no]["steps"].append({"type": type_, "lang": langs.get(lang, lang), "term": term, "gloss": gloss})
    for wid, no, text in db.execute("SELECT word_id, etym_no, text FROM etymologies ORDER BY word_id, etym_no"):
        groups[wid][no]["text"] = text
    for wid, no, form, kind, source_lang, meaning, gloss in db.execute(
        "SELECT wm.word_id, wm.etym_no, m.form, m.kind, m.source_lang, m.meaning, wm.gloss"
        " FROM word_morphemes wm JOIN morphemes m ON m.id = wm.morpheme_id"
        " ORDER BY wm.word_id, wm.etym_no, wm.position"
    ):
        groups[wid][no]["morphemes"].append({
            "form": form,
            "kind": kind,
            "lang": langs.get(source_lang, source_lang),
            "meaning": meaning,
            "gloss": gloss,
        })
    rows = db.execute(
        f"SELECT w.id, w.word FROM words w WHERE {WORD_BOOK} AND {HAS_STEPS} ORDER BY w.id"
    ).fetchall()
    words = []
    for wid, word in rows:
        etys = []
        for no in sorted(groups[wid]):
            group = groups[wid][no]
            item = {"etym_no": no}
            if group["text"]:
                item["text"] = group["text"]
            if group["steps"]:
                item["steps"] = group["steps"]
            if group["morphemes"]:
                item["morphemes"] = group["morphemes"]
            etys.append(item)
        words.append({"word_id": wid, "word": word, "etymologies": etys})
    return words


TASKS = {
    "examples": examples_words,
    "core_sense": core_sense_words,
    "collocations": collocations_words,
    "etymology": etymology_words,
}


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
