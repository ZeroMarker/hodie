"""校验 vocab-ai/ 下 AI 生成的结果,输出通过率和不通过的 word_id。

用法:
    python -I scripts/vocab/ai_validate.py examples                  # 校验全部已生成批次
    python -I scripts/vocab/ai_validate.py core_sense --batch 1      # 只校验第 1 批
    python -I scripts/vocab/ai_validate.py core_sense --review 200   # 另导出人工抽检 CSV

任务 1(例句)的校验规则(见 docs/stage3-vocab-tasks.md):
    1. 每个词恰好 2 条例句,两条不重复;
    2. 英文 6 到 14 个词;
    3. 用 tatoeba.form_map 还原词形后,句中必须包含目标词;
    4. 其余词的 freq_rank 中位数要低于目标词;
    5. 中文非空,且不含英文目标词;
    6. 中文必须用全角标点,出现半角 , . ! ? : ; 即不通过。

任务 2(核心义对应 WordNet 词义)的校验规则:
    1. core_sense_id 要么是 null,要么必须是该词 sense id 之一;
    2. 非 null 时,词性要和 ECDICT 释义第一行的词性标记一致
       (n.→n、a.→a、vt./vi./v.→v、adv.→r、pl.→n;介词、数词、代词、感叹词
        和没有标记的不校验词性,因为 WordNet 没有对应词性)。

任务 3(补齐搭配)的校验规则:
    1. 每词 1 到 3 条搭配,`phrase` 不重复,`partner` 不重复;
    2. `phrase` 必须包含目标词或其变化形式;
    3. `partner` 必须是单词、能在 form_map 里找到(即词库中的词),不能是目标词本身,
       且必须真的出现在 `phrase` 里;
    4. 每条搭配要有非空中文释义。

任务 4(词源中文讲解)的校验规则:
    1. 讲解非空、不超过 120 字、含中文,且不含阿拉伯数字(不得编造年代);
    2. 讲解中出现的每一段拉丁字母词形,都必须出现在该词的输入里
       (etymology_steps、etymologies.text、word_morphemes 和词本身)。
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
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402
import tatoeba  # noqa: E402

MIN_TOKENS, MAX_TOKENS = 6, 14
PER_WORD = 2
MAX_COLLOCS = 3
MIN_COLLOC_TOKENS, MAX_COLLOC_TOKENS = 2, 6
MAX_ETYM_CHARS = 120
# 拉丁字母词形和中文判断:词源讲解里出现的拉丁词形必须来自输入
LATIN_RE = re.compile(r"[A-Za-z]+")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
# 中文用全角标点,出现半角 , . ! ? : ; 即判为不通过
HALF_PUNCT_RE = re.compile(r"[,\.!?:;]")
# 切词:带连字符的复合词算一个词(如 well-being、x-ray),
# 否则连字符目标词会被拆开,永远匹配不到(见 form_map 键为连字符形式)。
TOKEN_RE = re.compile(r"[a-z]+(?:['-][a-z]+)*")

# ECDICT 释义首行的词性标记 → WordNet 词性;无法对应的不校验词性
ECDICT_POS = {"n.": "n", "a.": "a", "vt.": "v", "vi.": "v", "v.": "v", "adv.": "r", "pl.": "n"}
# WordNet 的形容词卫星词义(s)按形容词(a)处理
SENSE_POS = {"s": "a"}

REVIEW_HEADER = {
    "examples": ["word_id", "word", "text_en", "text_zh", "prompt_version", "model"],
    "core_sense": ["word_id", "word", "zh", "core_sense_id", "sense_pos", "sense_def", "prompt_version", "model"],
    "collocations": ["word_id", "word", "phrase", "partner", "zh", "prompt_version", "model"],
    "etymology": ["word_id", "word", "text", "prompt_version", "model"],
}


def load_examples_words(db):
    """word_id → (word, freq_rank),缺 freq_rank 的词按最生僻处理。"""
    rows = db.execute(
        "SELECT id, word, coalesce(freq_rank, ?) FROM words", (tatoeba.UNKNOWN_RANK,)
    ).fetchall()
    return {wid: (word, rank) for wid, word, rank in rows}


def load_core_sense_words(db):
    """word_id → 词、释义首行、词性标记和全部词义 (pos, definition)。"""
    words = {}
    for wid, word, zh in db.execute("SELECT id, word, translation_zh FROM words"):
        _, pos = ai.split_zh(zh)
        words[wid] = {"word": word, "zh": (zh or "").split("\n", 1)[0].strip(), "pos": pos, "senses": {}}
    for wid, sid, pos, definition in db.execute("SELECT word_id, id, pos, definition FROM senses"):
        if wid in words:
            words[wid]["senses"][sid] = (pos, definition)
    return words


def load_collocations_words(db):
    """word_id → 词;搭配词的解析用 tatoeba.form_map。"""
    return {wid: word for wid, word in db.execute("SELECT id, word FROM words")}


def load_etymology_words(db):
    """word_id → 词,以及该词输入里出现过的拉丁字母词形集合(小写)。

    输入指 ai_export.py 导出给模型的内容:etymology_steps、etymologies.text、
    word_morphemes(含语素原义)和词本身;校验讲解里的词形是否都在其中。
    """
    langs = dict(db.execute("SELECT code, name FROM languages"))
    fields = defaultdict(list)
    for wid, word in db.execute("SELECT id, word FROM words"):
        fields[wid].append(word)
    for wid, lang, term, gloss in db.execute("SELECT word_id, lang, term, gloss FROM etymology_steps"):
        fields[wid] += [langs.get(lang, lang), term, gloss]
    for wid, text in db.execute("SELECT word_id, text FROM etymologies"):
        fields[wid].append(text)
    for wid, form, kind, source_lang, meaning, gloss in db.execute(
        "SELECT wm.word_id, m.form, m.kind, m.source_lang, m.meaning, wm.gloss"
        " FROM word_morphemes wm JOIN morphemes m ON m.id = wm.morpheme_id"
    ):
        fields[wid] += [form, kind, langs.get(source_lang, source_lang), meaning, gloss]
    words = {}
    for wid, word in db.execute("SELECT id, word FROM words"):
        tokens = set()
        for value in fields.get(wid, ()):
            if value:
                tokens.update(token.lower() for token in LATIN_RE.findall(value))
        words[wid] = {"word": word, "tokens": tokens}
    return words


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


def check_example_record(rec, ctx, version):
    """校验一行例句结果,返回 (不通过原因, 通过时可用于抽检的例句)。"""
    words, forms = ctx["words"], ctx["forms"]
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


def check_core_sense_record(rec, ctx, version):
    """校验一行核心义词义结果,返回 (不通过原因, 通过时可用于抽检的行)。"""
    words = ctx["words"]
    wid = rec.get("word_id")
    if wid not in words or not words[wid]["senses"]:
        return [f"word_id {wid} 不在库中或没有词义"], []
    reasons = []
    if rec.get("prompt_version") != version:
        reasons.append(f"prompt_version {rec.get('prompt_version')} 不是 {version}")
    sid = rec.get("core_sense_id")
    sense = None
    if sid is not None:
        if not isinstance(sid, str) or sid not in words[wid]["senses"]:
            reasons.append(f"core_sense_id {sid!r} 不是该词的词义")
        else:
            sense = words[wid]["senses"][sid]
            want = ECDICT_POS.get(words[wid]["pos"])
            got = SENSE_POS.get(sense[0], sense[0])
            if want and got != want:
                reasons.append(f"词性 {got} 与释义首行 {words[wid]['pos']} 不一致")
    if reasons:
        return reasons, []
    return [], [(wid, words[wid]["word"], words[wid]["zh"], sid,
                 sense[0] if sense else "", (sense[1] or "") if sense else "",
                 rec.get("prompt_version"), rec.get("model"))]


def check_collocations_record(rec, ctx, version):
    """校验一行搭配结果,返回 (不通过原因, 通过时可用于抽检的行)。"""
    words, forms = ctx["words"], ctx["forms"]
    wid = rec.get("word_id")
    if wid not in words:
        return [f"word_id {wid} 不在库中"], []
    reasons = []
    if rec.get("prompt_version") != version:
        reasons.append(f"prompt_version {rec.get('prompt_version')} 不是 {version}")
    items = rec.get("collocations")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_COLLOCS:
        return reasons + [f"搭配条数不在 1-{MAX_COLLOCS}"], []
    seen_partners, seen_phrases = set(), set()
    samples = []
    for item in items:
        if not isinstance(item, dict):
            reasons.append("搭配不是对象")
            continue
        phrase = (item.get("phrase") or "").strip()
        partner = (item.get("partner") or "").strip().lower()
        zh = (item.get("zh") or "").strip()
        tokens = TOKEN_RE.findall(phrase.lower())
        if not phrase:
            reasons.append("搭配为空")
        elif not MIN_COLLOC_TOKENS <= len(tokens) <= MAX_COLLOC_TOKENS:
            reasons.append(f"搭配 {phrase!r} 有 {len(tokens)} 个词,不在 {MIN_COLLOC_TOKENS}-{MAX_COLLOC_TOKENS}")
        if phrase and not target_span(tokens, words[wid], wid, forms):
            reasons.append(f"搭配 {phrase!r} 不含目标词")
        hit = forms.get(partner)
        if not partner or " " in partner:
            reasons.append(f"搭配词 {partner!r} 不是单个词")
        elif hit is None:
            reasons.append(f"搭配词 {partner!r} 不在词库")
        else:
            if hit[0] == wid:
                reasons.append(f"搭配词 {partner!r} 是目标词本身")
            if phrase and not any(forms.get(t, (None,))[0] == hit[0] for t in tokens):
                reasons.append(f"搭配词 {partner!r} 不在搭配 {phrase!r} 中")
            if hit[0] in seen_partners:
                reasons.append(f"搭配词重复 {partner!r}")
            seen_partners.add(hit[0])
        if phrase in seen_phrases:
            reasons.append(f"搭配重复 {phrase!r}")
        seen_phrases.add(phrase)
        if not zh:
            reasons.append(f"搭配 {phrase!r} 缺中文释义")
        samples.append((wid, words[wid], phrase, partner, zh, rec.get("prompt_version"), rec.get("model")))
    if reasons:
        return reasons, []
    return [], samples


def check_etymology_record(rec, ctx, version):
    """校验一行词源讲解,返回 (不通过原因, 通过时可用于抽检的行)。"""
    entry = ctx["words"].get(rec.get("word_id"))
    if entry is None:
        return [f"word_id {rec.get('word_id')} 不在库中"], []
    reasons = []
    if rec.get("prompt_version") != version:
        reasons.append(f"prompt_version {rec.get('prompt_version')} 不是 {version}")
    text = (rec.get("text") or "").strip()
    if not text:
        reasons.append("讲解为空")
    else:
        if len(text) > MAX_ETYM_CHARS:
            reasons.append(f"讲解 {len(text)} 字,超过 {MAX_ETYM_CHARS}")
        if not CJK_RE.search(text):
            reasons.append("讲解没有中文")
        if re.search(r"[0-9]", text):
            reasons.append("讲解含阿拉伯数字(不得编造年代)")
        missing = sorted({t.lower() for t in LATIN_RE.findall(text)} - entry["tokens"])
        if missing:
            reasons.append(f"词形不在输入里:{', '.join(missing)}")
    if reasons:
        return reasons, []
    return [], [(rec.get("word_id"), entry["word"], text, rec.get("prompt_version"), rec.get("model"))]


LOADERS = {
    "examples": load_examples_words,
    "core_sense": load_core_sense_words,
    "collocations": load_collocations_words,
    "etymology": load_etymology_words,
}
CHECKERS = {
    "examples": check_example_record,
    "core_sense": check_core_sense_record,
    "collocations": check_collocations_record,
    "etymology": check_etymology_record,
}


def load_context(task, db):
    ctx = {"words": LOADERS[task](db)}
    if task in ("examples", "collocations"):
        ctx["forms"] = tatoeba.form_map(db)
    return ctx


def expected_batches(task):
    """从已导出的输入文件读回每个批次的 word_id,用于报告未生成的词。"""
    expected = {}
    for path in sorted((ai.INPUT / task).glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        expected[path.stem] = {w["word_id"] for w in data["words"]}
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("task", choices=sorted(ai.PROMPT_VERSION), help="任务名,如 core_sense")
    parser.add_argument("--batch", type=int, help="只校验这个批次(从 1 开始)")
    parser.add_argument("--review", type=int, default=200, help="人工抽检 CSV 的条数,0 表示不导出")
    args = parser.parse_args()

    version = ai.PROMPT_VERSION[args.task]
    db = sqlite3.connect(ai.DB)
    ctx = load_context(args.task, db)
    check = CHECKERS[args.task]

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
            reasons, samples = check(rec, ctx, version)
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
        entry = ctx["words"].get(wid)
        word = entry if isinstance(entry, str) else (entry or {}).get("word", "?")
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
            writer.writerow(REVIEW_HEADER[args.task])
            writer.writerows(sorted(rows, key=lambda r: r[0]))
        print(f"抽检导出 {len(rows)} 条到 {path}")


if __name__ == "__main__":
    main()
