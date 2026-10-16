"""把 data/raw 下的原始词库和 vocab-ai/ 下的 AI 补全结果合并成 data/build/vocab.db(SQLite)。

收录范围:带考试标签、在 NGSL 或 CEFR 词表中,或 wordfreq 排名前 30000 的 ECDICT 词条;
只因词频入选的,须有英文释义,并跳过专有名词和屈折形式。
ECDICT 的 collins、oxford、bnc、frq 列来源不明,不导入(见 docs/vocab-sources.md)。
wordfreq 数据禁止转成 CSV 再分发,所以输出只用 SQLite。
"""

import csv
import re
import sys
import sqlite3
from pathlib import Path

from wordfreq import top_n_list, zipf_frequency

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I 模式下需手动加入本目录
import ai_common as ai  # noqa: E402
import collocations  # noqa: E402
import tatoeba  # noqa: E402
import wiktionary  # noqa: E402
import wordnet  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build" / "vocab.db"
AI_OUT = ROOT / "vocab-ai"  # 阶段 3 AI 生成的结果,入库
# 词条 id 登记表,入库;重建时沿用旧 id,新词追加,用户数据可以放心引用 words.id
ID_REGISTRY = Path(__file__).resolve().parent / "word_ids.tsv"

FREQ_TOP = 30000
CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]
# 人名、地名、公司名词条,如「[人名] 弗朗茨」「布鲁克(女子名)」
NAME_RE = re.compile(r"人名|地名|男子名|女子名|姓氏|公司")
EXAM_TAGS = {"zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre"}


def read_csv(name):
    with open(RAW / name, encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def unescape(text):
    """ECDICT 的多行释义用字面量 \\n 分隔。"""
    return text.replace("\\r", "").replace("\\n", "\n").strip() or None


def load_cefr():
    """headword 可能是 a.m./A.M./am/AM 这样的变体组合;同词多词性取最低等级。"""
    levels = {}
    for name in ["cefrj-vocabulary-profile-1.5.csv", "octanove-vocabulary-profile-c1c2-1.0.csv"]:
        for row in read_csv(name):
            level = row["CEFR"].strip().upper()
            if level not in CEFR_ORDER:
                continue
            for variant in row["headword"].split("/"):
                word = variant.strip().lower()
                if word and (word not in levels or CEFR_ORDER.index(level) < CEFR_ORDER.index(levels[word])):
                    levels[word] = level
    return levels


def load_ngsl():
    return {row["Lemma"].strip().lower(): int(row["SFI Rank"]) for row in read_csv("ngsl_stats.csv")}


def load_registry():
    if not ID_REGISTRY.exists():
        return {}
    with open(ID_REGISTRY, encoding="utf-8", newline="") as f:
        return {word: int(i) for i, word in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)}


def save_registry(ids):
    with open(ID_REGISTRY, "w", encoding="utf-8", newline="") as f:
        for word, i in sorted(ids.items(), key=lambda x: x[1]):
            f.write(f"{i}\t{word}\n")


def load_ai(db, reviews):
    """合并 vocab-ai/ 下各任务的 AI 补全结果;只做补充,不改动现有数据。

    结果由 opencode 按 vocab-ai/<任务>/PROMPT.md 生成、ai_validate.py 校验通过。
    入库行 source 写 ai:opencode/<model>,reviewed 取结果行里的值(默认 0,人工抽检后改 1)。
    任务 5 的全量审核结果(reviews)按 word_id 覆盖:ok/fix 的 reviewed 置 1、reject 置 0,
    fix 用改正后的内容替换原结果;reviewer 记审核模型。
    """
    for task_dir in sorted(p for p in AI_OUT.glob("*") if p.is_dir()):
        loader = AI_LOADERS.get(task_dir.name)
        if loader:
            loader(db, task_dir, reviews)


def apply_review(task, wid, content, rec, reviews):
    """把任务 5 的审核结果套到一条 AI 结果上。

    返回 (改正后的内容, reviewed, reviewer)。没有审核记录时保持原样。
    ok:内容不变、reviewed 置 1;fix:用 fix 里的内容、reviewed 置 1;
    reject:内容不变、reviewed 置 0。
    """
    reviewed = rec.get("reviewed", 0)
    reviewer = None
    rev = reviews.get((task, wid))
    if not rev:
        return content, reviewed, reviewer
    reviewer = rev.get("reviewer")
    verdict = rev.get("verdict")
    if verdict == "fix":
        fix = rev.get("fix")
        if isinstance(fix, dict) and ai.CONTENT_FIELD[task] in fix:
            content = fix[ai.CONTENT_FIELD[task]]
        reviewed = 1
    elif verdict == "ok":
        reviewed = 1
    elif verdict == "reject":
        reviewed = 0
    return content, reviewed, reviewer


def load_ai_examples(db, path, reviews):
    """例句:为仍没有例句的词补充,每词 2 条,license 写 own。"""
    known = {row[0] for row in db.execute("SELECT id FROM words")}
    have = {row[0] for row in db.execute("SELECT DISTINCT word_id FROM examples")}
    rows = []
    for file in sorted(path.glob("*.jsonl")):
        records, errors = ai.read_jsonl(file)
        for error in errors:
            print(f"ai examples: 解析失败 {error}")
        for rec in records:
            wid = rec.get("word_id")
            if wid not in known or wid in have:
                continue  # 词不在库里,或已有例句(Tatoeba 或其他批次),保持原样
            have.add(wid)
            examples, reviewed, reviewer = apply_review("examples", wid, rec.get("examples") or [], rec, reviews)
            for i, ex in enumerate(examples):
                source = f"ai:opencode/{rec.get('model') or ai.DEFAULT_MODEL}"
                rows.append((wid, ex["text_en"], ex["text_zh"], source, f"ai-{wid}-{i}", reviewed, reviewer))
    db.executemany(
        "INSERT INTO examples (word_id, text_en, text_zh, source, source_id, license, reviewed, reviewer)"
        " VALUES (?,?,?,?,?,'own',?,?)",
        rows,
    )
    print("ai examples:", len(rows))


def load_ai_core_sense(db, path, reviews):
    """核心义对应的 WordNet 词义:写 words.core_sense_id,只接受属于该词的 sense id。

    任务 5 的审核结果同时写 core_sense_reviewed 和 core_sense_reviewer;
    fix 会把 core_sense_id 换成改正后的词义(可为 null)。
    """
    sense_ids = {}
    for wid, sid in db.execute("SELECT word_id, id FROM senses"):
        sense_ids.setdefault(wid, set()).add(sid)
    rows = []
    for file in sorted(path.glob("*.jsonl")):
        records, errors = ai.read_jsonl(file)
        for error in errors:
            print(f"ai core_sense: 解析失败 {error}")
        for rec in records:
            wid = rec.get("word_id")
            if wid not in sense_ids:
                continue
            sid, reviewed, reviewer = apply_review("core_sense", wid, rec.get("core_sense_id"), rec, reviews)
            if not (isinstance(sid, str) and sid in sense_ids[wid]):
                sid = None
            rows.append((sid, reviewed, reviewer, wid))
    db.executemany(
        "UPDATE words SET core_sense_id = ?, core_sense_reviewed = ?, core_sense_reviewer = ? WHERE id = ?",
        rows,
    )
    print("ai core_sense:", len(rows))


def load_ai_collocations(db, path, reviews):
    """搭配:为仍没有非 AI 搭配的词补充,partner 解析成 word_id;freq/log_dice 置空。

    partner 优先取结果里的原形,若词库中没有再按变化形式还原;插不进去的跳过。
    """
    known = {row[0] for row in db.execute("SELECT id FROM words")}
    have = {row[0] for row in db.execute(
        "SELECT DISTINCT word_id FROM collocations WHERE source NOT LIKE 'ai:%'")}
    forms = tatoeba.form_map(db)
    rows = []
    for file in sorted(path.glob("*.jsonl")):
        records, errors = ai.read_jsonl(file)
        for error in errors:
            print(f"ai collocations: 解析失败 {error}")
        for rec in records:
            wid = rec.get("word_id")
            if wid not in known or wid in have:
                continue  # 词不在库里,或已有 Tatoeba 搭配,保持原样
            source = f"ai:opencode/{rec.get('model') or ai.DEFAULT_MODEL}"
            items, reviewed, reviewer = apply_review(
                "collocations", wid, rec.get("collocations") or [], rec, reviews)
            added = False
            for item in items:
                partner = forms.get((item.get("partner") or "").strip().lower())
                if not partner or partner[0] == wid:
                    continue
                rows.append((wid, partner[0], item["phrase"], None, None, source, reviewed, reviewer))
                added = True
            if added:
                have.add(wid)
    db.executemany(
        "INSERT OR IGNORE INTO collocations (word_id, partner_id, phrase, freq, log_dice, source, reviewed, reviewer)"
        " VALUES (?,?,?,?,?,?,?,?)",
        rows,
    )
    print("ai collocations:", len(rows))


def load_ai_etymology(db, path, reviews):
    """词源讲解:每词一条,写进 etymology_notes,reviewed 取结果行里的值(默认 0)。"""
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS etymology_notes (
            word_id INTEGER PRIMARY KEY REFERENCES words(id),
            text TEXT NOT NULL,
            source TEXT NOT NULL,
            reviewed INTEGER NOT NULL DEFAULT 0,
            reviewer TEXT
        );
        """
    )
    known = {row[0] for row in db.execute("SELECT id FROM words")}
    rows = []
    for file in sorted(path.glob("*.jsonl")):
        records, errors = ai.read_jsonl(file)
        for error in errors:
            print(f"ai etymology: 解析失败 {error}")
        for rec in records:
            wid = rec.get("word_id")
            text = (rec.get("text") or "").strip()
            if wid not in known or not text:
                continue
            text, reviewed, reviewer = apply_review("etymology", wid, text, rec, reviews)
            source = f"ai:opencode/{rec.get('model') or ai.DEFAULT_MODEL}"
            rows.append((wid, text, source, reviewed, reviewer))
    db.executemany(
        "INSERT OR IGNORE INTO etymology_notes (word_id, text, source, reviewed, reviewer) VALUES (?,?,?,?,?)",
        rows,
    )
    print("ai etymology:", len(rows))


AI_LOADERS = {
    "examples": load_ai_examples,
    "core_sense": load_ai_core_sense,
    "collocations": load_ai_collocations,
    "etymology": load_ai_etymology,
}


def main():
    cefr = load_cefr()
    ngsl = load_ngsl()
    freq_rank = {w: i + 1 for i, w in enumerate(top_n_list("en", FREQ_TOP))}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.unlink(missing_ok=True)
    db = sqlite3.connect(OUT)
    db.executescript(
        """
        CREATE TABLE words (
            id INTEGER PRIMARY KEY,
            word TEXT NOT NULL UNIQUE,
            phonetic TEXT,
            definition_en TEXT,
            translation_zh TEXT,
            pos TEXT,
            exchange TEXT,
            cefr TEXT,
            freq_rank INTEGER,
            zipf REAL,
            ngsl_rank INTEGER,
            core_sense_id TEXT,
            core_sense_reviewed INTEGER,
            core_sense_reviewer TEXT
        );
        CREATE TABLE word_lists (
            list TEXT NOT NULL,
            word_id INTEGER NOT NULL REFERENCES words(id),
            PRIMARY KEY (list, word_id)
        );
        """
    )

    # 同一小写形式只收一条,优先小写原形(hood 而不是 Hood)
    rows = {}
    for row in read_csv("ecdict.csv"):
        word = row["word"].strip()
        key = word.lower()
        if key not in rows or (word == key and rows[key]["word"].strip() != key):
            rows[key] = row

    registry = load_registry()
    seen = set()
    for key, row in rows.items():
        word = row["word"].strip()
        tags = set(row["tag"].split()) & EXAM_TAGS
        listed = tags or key in ngsl or key in cefr
        # 只因词频入选的词,跳过专有名词和屈折形式(exchange 含 0: 表示有原形)
        freq_only = (
            key in freq_rank
            and word == key
            and "0:" not in row["exchange"]
            and row["definition"]
            and not NAME_RE.search(row["translation"])
        )
        if not (listed or freq_only):
            continue
        seen.add(key)
        if word not in registry:
            registry[word] = max(registry.values(), default=0) + 1
        cur = db.execute(
            "INSERT INTO words (id, word, phonetic, definition_en, translation_zh, pos, exchange,"
            " cefr, freq_rank, zipf, ngsl_rank) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                registry[word],
                word,
                row["phonetic"] or None,
                unescape(row["definition"]),
                unescape(row["translation"]),
                row["pos"] or None,
                row["exchange"] or None,
                cefr.get(key),
                freq_rank.get(key),
                zipf_frequency(key, "en") or None,
                ngsl.get(key),
            ),
        )
        lists = tags | ({"ngsl"} if key in ngsl else set())
        db.executemany("INSERT INTO word_lists VALUES (?, ?)", [(l, cur.lastrowid) for l in lists])

    save_registry(registry)
    wordnet.load(db, RAW)
    tatoeba.load(db, RAW)
    collocations.load(db, RAW)
    wiktionary.load(db, RAW)
    reviews, review_errors = ai.load_reviews_for_all()
    for error in review_errors:
        print(f"ai review: 解析失败 {error}")
    load_ai(db, reviews)
    db.commit()
    print("words:", db.execute("SELECT count(*) FROM words").fetchone()[0])
    for name, n in db.execute("SELECT list, count(*) FROM word_lists GROUP BY list ORDER BY list"):
        print(f"  {name}: {n}")
    print("cefr:", db.execute("SELECT count(*) FROM words WHERE cefr IS NOT NULL").fetchone()[0])
    missing = [w for w in ngsl if w not in seen]
    print("ngsl not in ecdict:", len(missing), missing[:20])
    missing = [w for w in cefr if w not in seen]
    print("cefr not in ecdict:", len(missing), missing[:20])


if __name__ == "__main__":
    main()
