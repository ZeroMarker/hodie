"""从 Tatoeba 全部英文句子统计常见搭配,写入 collocations。

对每个词条,统计窗口 ±3 内的实词搭配词,按 logDice 打分(14 + log2(2·f_xy / (f_x + f_y)));
展示形式取两词之间最常见的原文片段,如 decision 的 make a decision。
停用词、人名不作搭配词。只统计,不生成,结果仍需人工抽检。
"""

import math
import re
from collections import Counter, defaultdict

from tatoeba import ENG, TOKEN_RE, form_map, read_tsv

WINDOW = 3
MIN_COUNT = 5
MIN_LOGDICE = 7.0
PER_WORD = 5

STOPWORDS = set("""
a an the and or but if so as of to in on at by for from with about into over after before up down out off
than then too very not no nor i me my mine you your yours he him his she her hers it its we us our ours
they them their theirs this that these those there here what which who whom whose when where why how
is am are was were be been being will would shall should can could
may might must ll re ve d s t m just also all any some each every both either neither one much many more
most such own same other only now again even still yet ever never always often there's it's don't
""".split())
NAMES = set("tom mary john alice bob jack ken yanni skura sami layla dan linda mike".split())

SCHEMA = """
CREATE TABLE collocations (
    word_id INTEGER NOT NULL REFERENCES words(id),
    partner_id INTEGER NOT NULL REFERENCES words(id),
    phrase TEXT NOT NULL,
    freq INTEGER NOT NULL,
    log_dice REAL NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (word_id, partner_id)
);
"""


def load(db, raw):
    db.executescript(SCHEMA)
    forms = form_map(db)
    content = {}  # 词形 → word_id,只含可作搭配词的实词
    for form, (wid, _) in forms.items():
        if form not in STOPWORDS and form not in NAMES and len(form) > 1:
            content[form] = wid

    def sentences():
        seen = set()
        for row in read_tsv(raw / ENG):
            if row[2] not in seen:
                seen.add(row[2])
                tokens = TOKEN_RE.findall(row[2].lower())
                yield tokens, [content.get(t) for t in tokens]

    def windows(ids):
        for i, wid in enumerate(ids):
            if wid:
                for j in range(max(0, i - WINDOW), min(len(ids), i + WINDOW + 1)):
                    if j != i and ids[j] and ids[j] != wid:
                        yield i, j, wid, ids[j]

    # 第一遍只计数;第二遍只为入选的词对记录原文片段,控制内存
    unigram, pair, n = Counter(), Counter(), 0
    for _, ids in sentences():
        n += 1
        unigram.update(set(i for i in ids if i))
        pair.update((w, o) for _, _, w, o in windows(ids))

    best = defaultdict(list)
    for (wid, other), f in pair.items():
        if f < MIN_COUNT:
            continue
        score = 14 + math.log2(2 * f / (unigram[wid] + unigram[other]))
        if score >= MIN_LOGDICE:
            best[wid].append((score, f, other))
    chosen = {}
    for wid, cands in best.items():
        for score, f, other in sorted(cands, reverse=True)[:PER_WORD]:
            chosen[wid, other] = (f, round(score, 2))
    spans = defaultdict(Counter)
    for tokens, ids in sentences():
        for i, j, w, o in windows(ids):
            if (w, o) in chosen:
                spans[w, o][" ".join(tokens[min(i, j): max(i, j) + 1])] += 1
    rows = [(w, o, spans[w, o].most_common(1)[0][0], f, score) for (w, o), (f, score) in chosen.items()]
    db.executemany("INSERT INTO collocations VALUES (?,?,?,?,?,'tatoeba-logdice')", rows)
    print("collocations:", len(rows), "words with collocations:", len(best), "sentences:", n)
