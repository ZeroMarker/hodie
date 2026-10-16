"""导入 Tatoeba 中英对照例句到 examples。

每个词最多取 3 句:先按词形变化(ECDICT exchange)把句中词还原到词条,
再优先选「其余词都更常见」的短句,让例句只含一个难点。
中文统一转为简体。句子按 CC BY 2.0 FR 处理,作者用户名随例句保存,用于署名。
"""

import bz2
import csv
import re
from collections import defaultdict

from opencc import OpenCC

ENG = "eng_sentences_detailed.tsv.bz2"
CMN = "cmn_sentences_detailed.tsv.bz2"
LINKS = "eng-cmn_links.tsv.bz2"

PER_WORD = 3
MIN_TOKENS, MAX_TOKENS = 4, 14
UNKNOWN_RANK = 100000
TOKEN_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")

SCHEMA = """
CREATE TABLE examples (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id),
    text_en TEXT NOT NULL,
    text_zh TEXT NOT NULL,
    audio_url TEXT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    author TEXT,
    license TEXT NOT NULL,
    reviewed INTEGER NOT NULL DEFAULT 1,
    reviewer TEXT
);
CREATE INDEX examples_word ON examples(word_id);
"""


def read_tsv(path):
    with bz2.open(path, "rt", encoding="utf-8", newline="") as f:
        yield from csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


def form_map(db):
    """词形 → (word_id, 频率排名);exchange 形如 p:went/d:gone/3:goes。"""
    forms = {}
    rows = db.execute("SELECT id, word, exchange, coalesce(freq_rank, ?) FROM words", (UNKNOWN_RANK,)).fetchall()
    for wid, word, exchange, rank in rows:
        for part in (exchange or "").split("/"):
            kind, _, form = part.partition(":")
            if kind in "pdi3rs" and form:  # 0: 和 1: 指向原形,不是本词的变化形式
                forms.setdefault(form.lower(), (wid, rank))
    for wid, word, _, rank in rows:
        forms[word.lower()] = (wid, rank)  # 原形优先于变化形式
    return forms


def load(db, raw):
    db.executescript(SCHEMA)
    forms = form_map(db)

    t2s = OpenCC("t2s")  # Tatoeba 中文句子繁简混杂,统一转简体
    zh = {}
    for row in read_tsv(raw / CMN):
        zh[row[0]] = (row[2], row[3])  # 转换放到选句之后,只处理用到的句子
    links = defaultdict(list)
    for eng_id, cmn_id in read_tsv(raw / LINKS):
        if cmn_id in zh:
            links[eng_id].append(cmn_id)

    candidates = defaultdict(list)  # word_id → [(score, length, eng_id, text, author)]
    seen_text = set()
    for row in read_tsv(raw / ENG):
        eng_id, _, text, author = row[:4]
        if eng_id not in links or text in seen_text:
            continue
        seen_text.add(text)
        tokens = TOKEN_RE.findall(text.lower())
        if not MIN_TOKENS <= len(tokens) <= MAX_TOKENS:
            continue
        hits = [(t, forms.get(t, (None, UNKNOWN_RANK))) for t in tokens]
        for i, (_, (wid, _)) in enumerate(hits):
            if wid is None:
                continue
            others = [rank for j, (_, (_, rank)) in enumerate(hits) if j != i]
            candidates[wid].append((max(others), len(text), eng_id, text, author))

    rows = []
    for wid, cands in candidates.items():
        for _, _, eng_id, text, author in sorted(set(cands))[:PER_WORD]:
            cmn_text, cmn_author = zh[min(links[eng_id], key=int)]
            authors = " / ".join(a for a in dict.fromkeys([author, cmn_author]) if a and a != "\\N")
            rows.append((wid, text, t2s.convert(cmn_text), f"{eng_id}-{min(links[eng_id], key=int)}", authors or None))
    db.executemany(
        "INSERT INTO examples (word_id, text_en, text_zh, source, source_id, author, license)"
        " VALUES (?,?,?,'tatoeba',?,?,'CC BY 2.0 FR')",
        rows,
    )
    print("examples:", len(rows), "words with examples:", len(candidates), "en-zh pairs:", len(links))
