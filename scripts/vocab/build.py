"""把 data/raw 下的原始词库合并成 data/build/vocab.db(SQLite)。

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
import collocations  # noqa: E402
import tatoeba  # noqa: E402
import wiktionary  # noqa: E402
import wordnet  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build" / "vocab.db"
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
            ngsl_rank INTEGER
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
