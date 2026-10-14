"""校验 vocab-ai/ 下 AI 生成的结果,输出通过率和不通过的 word_id。

用法:
    python -I scripts/vocab/ai_validate.py examples                  # 校验全部已生成批次
    python -I scripts/vocab/ai_validate.py examples --batch 1        # 只校验第 1 批
    python -I scripts/vocab/ai_validate.py examples --review 200     # 另导出人工抽检 CSV

任务 1(例句)的校验规则(见 docs/stage3-vocab-tasks.md):
    1. 每个词恰好 2 条例句,两条不重复;
    2. 英文 6 到 14 个词;
    3. 用 tatoeba.form_map 还原词形后,句中必须包含目标词;
    4. 其余词的 freq_rank 中位数要低于目标词;
    5. 中文非空,且不含英文目标词;
    6. 中文必须用全角标点,出现半角 , . ! ? : ; 即不通过。
不通过的结果丢弃或重写后重跑,不入库。
"""

import argparse
import csv
import json
import random
import re
import sqlite3
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402
import tatoeba  # noqa: E402

MIN_TOKENS, MAX_TOKENS = 6, 14
PER_WORD = 2
# 中文用全角标点,出现半角 , . ! ? : ; 即判为不通过
HALF_PUNCT_RE = re.compile(r"[,\.!?:;]")
# 切词:带连字符的复合词算一个词(如 well-being、x-ray),
# 否则连字符目标词会被拆开,永远匹配不到(见 form_map 键为连字符形式)。
TOKEN_RE = re.compile(r"[a-z]+(?:['-][a-z]+)*")


def load_words(db):
    """word_id → (word, freq_rank),缺 freq_rank 的词按最生僻处理。"""
    rows = db.execute(
        "SELECT id, word, coalesce(freq_rank, ?) FROM words", (tatoeba.UNKNOWN_RANK,)
    ).fetchall()
    return {wid: (word, rank) for wid, word, rank in rows}


def target_span(tokens, word, word_id, forms):
    """句中目标词占据的下标;找不到返回 None。

    单词用 form_map 还原词形(如 abandons → abandonment);多词条目(如 account for)
    form_map 无法逐词还原,改为匹配连续的原形。
    """
    if " " in word:
        parts = word.lower().split()
        for i in range(len(tokens) - len(parts) + 1):
            if tokens[i:i + len(parts)] == parts:
                return set(range(i, i + len(parts)))
        return None
    span = {i for i, t in enumerate(tokens) if forms.get(t, (None,))[0] == word_id}
    if span:
        return span
    # 含缩写点的目标词(如 no.、B.C.、i.e.):切词会把点丢掉,按去除非字母后
    # 的连续 token 再匹配一次。
    if "." in word:
        norm = re.sub(r"[^a-z]", "", word.lower())
        for i in range(len(tokens)):
            acc = ""
            for j in range(i, len(tokens)):
                acc += re.sub(r"[^a-z]", "", tokens[j])
                if acc == norm:
                    return set(range(i, j + 1))
                if len(acc) >= len(norm):
                    break
    return None


def check_example(text_en, text_zh, word, word_id, rank, forms):
    """校验一条例句,返回不通过的原因(空列表表示通过)。"""
    reasons = []
    tokens = TOKEN_RE.findall(text_en.lower())
    if not MIN_TOKENS <= len(tokens) <= MAX_TOKENS:
        reasons.append(f"英文 {len(tokens)} 词,不在 {MIN_TOKENS}-{MAX_TOKENS}")
    span = target_span(tokens, word, word_id, forms)
    if not span:
        reasons.append("句中没有目标词")
    others = [
        forms[t][1] if t in forms else tatoeba.UNKNOWN_RANK
        for i, t in enumerate(tokens)
        if not span or i not in span
    ]
    if not others:
        reasons.append("句中没有其他词")
    else:
        median = statistics.median(others)
        if median >= rank:
            reasons.append(f"其余词中位词频 {median:g} 不低于目标词 {rank}")
    if not text_zh:
        reasons.append("中文为空")
    elif word.lower() in text_zh.lower():
        reasons.append("中文包含英文目标词")
    if HALF_PUNCT_RE.search(text_zh):
        reasons.append("中文含半角标点")
    return reasons


def check_record(rec, words, forms, version):
    """校验一行结果,返回 (不通过原因, 通过时可用于抽检的例句)。"""
    wid = rec.get("word_id")
    if wid not in words:
        return [f"word_id {wid} 不在库中"], []
    reasons = []
    if rec.get("prompt_version") != version:
        reasons.append(f"prompt_version {rec.get('prompt_version')} 不是 {version}")
    examples = rec.get("examples")
    if not isinstance(examples, list) or len(examples) != PER_WORD:
        return reasons + [f"例句条数不是 {PER_WORD}"], []
    word, rank = words[wid]
    seen = set()
    for example in examples:
        if not isinstance(example, dict):
            reasons.append("例句不是对象")
            continue
        text_en = (example.get("text_en") or "").strip()
        text_zh = (example.get("text_zh") or "").strip()
        if text_en in seen:
            reasons.append("两条例句重复")
        seen.add(text_en)
        reasons += check_example(text_en, text_zh, word, wid, rank, forms)
    if reasons:
        return reasons, []
    return [], [(wid, word, e["text_en"], e["text_zh"], rec.get("prompt_version"), rec.get("model")) for e in examples]


def expected_batches(task):
    """从已导出的输入文件读回每个批次的 word_id,用于报告未生成的词。"""
    expected = {}
    for path in sorted((ai.INPUT / task).glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        expected[path.stem] = {w["word_id"] for w in data["words"]}
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("task", choices=sorted(ai.PROMPT_VERSION), help="任务名,如 examples")
    parser.add_argument("--batch", type=int, help="只校验这个批次(从 1 开始)")
    parser.add_argument("--review", type=int, default=200, help="人工抽检 CSV 的条数,0 表示不导出")
    args = parser.parse_args()

    version = ai.PROMPT_VERSION[args.task]
    db = sqlite3.connect(ai.DB)
    words = load_words(db)
    forms = tatoeba.form_map(db)

    paths = sorted((ai.AI / args.task).glob("*.jsonl"))
    if args.batch:
        paths = [p for p in paths if p.stem == f"{args.batch:04d}"]
    if not paths:
        parser.error(f"没有找到 vocab-ai/{args.task}/ 下的结果文件")

    passed, failed, review_rows, file_errors = set(), {}, [], []
    total_lines = 0
    for path in paths:
        records, errors = ai.read_jsonl(path)
        file_errors += errors
        total_lines += len(records)
        for rec in records:
            reasons, samples = check_record(rec, words, forms, version)
            if reasons:
                failed[rec.get("word_id")] = reasons
            else:
                passed.add(rec.get("word_id"))
                review_rows += samples

    print(f"任务 {args.task}:prompt_version={version},校验 {len(paths)} 个批次文件、{total_lines} 行")
    for error in file_errors:
        print(f"  解析失败 {error}")
    rate = len(passed) / total_lines * 100 if total_lines else 0.0
    print(f"通过 {len(passed)} 个词,不通过 {len(failed)} 个,通过率 {rate:.1f}%")
    for wid, reasons in list(failed.items())[:20]:
        word = words.get(wid, ("?",))[0]
        print(f"  不通过 {wid} {word}:{' ; '.join(reasons)}")
    if len(failed) > 20:
        print(f"  …另有 {len(failed) - 20} 个不通过")

    expected = expected_batches(args.task)
    stems = {p.stem for p in paths}
    expected = {k: v for k, v in expected.items() if k in stems}
    missing = sorted(set().union(*expected.values()) - passed - set(failed)) if expected else []
    if missing:
        print(f"未生成 {len(missing)} 个词,如 {missing[:20]}")

    if args.review > 0 and review_rows:
        path = ai.REVIEW / f"{args.task}.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = review_rows if len(review_rows) <= args.review else random.Random(0).sample(review_rows, args.review)
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["word_id", "word", "text_en", "text_zh", "prompt_version", "model"])
            writer.writerows(sorted(rows))
        print(f"抽检导出 {len(rows)} 条到 {path}")


if __name__ == "__main__":
    main()
