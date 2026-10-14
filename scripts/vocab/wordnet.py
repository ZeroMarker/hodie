"""导入 Open English WordNet:词义(senses)、词间关系(relations)和语域标签。

只保留 words 表中已有的词;关系的两端都必须在 words 表中,并记录源词义,
以便按词义展示(bank 的「河岸」和「银行」各有各的关系)。
"""

import gzip
import json
import xml.etree.ElementTree as ET

FILE = "english-wordnet-2025.xml.gz"

# 这些 synset 是「用法类别」,词义通过 exemplifies 关系指向它们
REGISTER_SYNSETS = {
    "oewn-07089193-n": "informal",  # colloquialism
    "oewn-07171981-n": "slang",
    "oewn-07087487-n": "archaic",
    "oewn-07139048-n": "vulgar",  # obscenity
    "oewn-06730109-n": "derogatory",  # disparagement
}

# WordNet 关系名 → relations.type;synonym 由同一 synset 推出
SENSE_RELATIONS = {"antonym": "antonym", "derivation": "derived_from", "pertainym": "pertainym"}
SYNSET_RELATIONS = {"hypernym": "hypernym", "hyponym": "hyponym", "similar": "similar"}

CONCRETE_LEXFILES = {"noun.animal", "noun.artifact", "noun.body", "noun.food", "noun.object", "noun.plant"}

SCHEMA = """
CREATE TABLE senses (
    id TEXT PRIMARY KEY,
    word_id INTEGER NOT NULL REFERENCES words(id),
    synset_id TEXT NOT NULL,
    pos TEXT NOT NULL,
    sense_order INTEGER NOT NULL,
    definition TEXT,
    examples TEXT,
    register TEXT,
    lexfile TEXT
);
CREATE INDEX senses_word ON senses(word_id);
CREATE TABLE relations (
    src_word_id INTEGER NOT NULL REFERENCES words(id),
    dst_word_id INTEGER NOT NULL REFERENCES words(id),
    type TEXT NOT NULL,
    src_sense_id TEXT NOT NULL REFERENCES senses(id),
    source TEXT NOT NULL,
    PRIMARY KEY (src_sense_id, dst_word_id, type)
);
CREATE INDEX relations_src ON relations(src_word_id);
"""


def parse(path):
    entries = []  # (lemma, pos, [(sense_id, synset_id, [(relType, target)])])
    synsets = {}  # id → {definition, examples, relations, register}
    for _, el in ET.iterparse(gzip.open(path), events=("end",)):
        if el.tag == "LexicalEntry":
            lemma = el.find("Lemma")
            senses = [
                (
                    s.get("id"),
                    s.get("synset"),
                    [(r.get("relType"), r.get("target")) for r in s.findall("SenseRelation")],
                )
                for s in el.findall("Sense")
            ]
            entries.append((lemma.get("writtenForm"), lemma.get("partOfSpeech"), senses))
            el.clear()
        elif el.tag == "Synset":
            rels = [(r.get("relType"), r.get("target")) for r in el.findall("SynsetRelation")]
            synsets[el.get("id")] = {
                "definition": el.findtext("Definition"),
                "lexfile": el.get("lexfile"),
                "examples": [e.text for e in el.findall("Example") if e.text],
                "relations": rels,
                "register": next((REGISTER_SYNSETS[t] for k, t in rels if k == "exemplifies" and t in REGISTER_SYNSETS), None),
            }
            el.clear()
    return entries, synsets


def mark_concrete(db):
    """首个名词词义属于可画出来的类别时,标为具体名词,用于「具体名词加图」。"""
    db.execute("ALTER TABLE words ADD COLUMN concrete INTEGER NOT NULL DEFAULT 0")
    placeholders = ",".join("?" * len(CONCRETE_LEXFILES))
    db.execute(
        f"UPDATE words SET concrete = 1 WHERE id IN (SELECT word_id FROM senses"
        f" WHERE pos = 'n' AND sense_order = 1 AND lexfile IN ({placeholders}))",
        sorted(CONCRETE_LEXFILES),
    )


def load(db, raw):
    db.executescript(SCHEMA)
    # 大小写精确匹配,避免 May(五月)这类专名词义挂到 may 上
    word_ids = {w: i for i, w in db.execute("SELECT id, word FROM words")}
    entries, synsets = parse(raw / FILE)

    sense_word = {}  # sense_id → word_id,解析 SenseRelation 目标用
    synset_words = {}  # synset_id → {word_id}
    for lemma, _, senses in entries:
        wid = word_ids.get(lemma)
        for sense_id, synset_id, _ in senses:
            if wid:
                sense_word[sense_id] = wid
                synset_words.setdefault(synset_id, set()).add(wid)

    rows, rels = [], set()
    for lemma, pos, senses in entries:
        wid = word_ids.get(lemma)
        if not wid:
            continue
        for order, (sense_id, synset_id, sense_rels) in enumerate(senses, 1):
            syn = synsets[synset_id]
            register = syn["register"] or next(
                (REGISTER_SYNSETS[t] for k, t in sense_rels if k == "exemplifies" and t in REGISTER_SYNSETS), None
            )
            rows.append((sense_id, wid, synset_id, pos, order, syn["definition"],
                         json.dumps(syn["examples"], ensure_ascii=False) if syn["examples"] else None, register,
                         syn["lexfile"]))
            for other in synset_words[synset_id] - {wid}:
                rels.add((wid, other, "synonym", sense_id))
            for kind, target in sense_rels:
                if kind in SENSE_RELATIONS and target in sense_word and sense_word[target] != wid:
                    rels.add((wid, sense_word[target], SENSE_RELATIONS[kind], sense_id))
            for kind, target in syn["relations"]:
                if kind in SYNSET_RELATIONS:
                    for other in synset_words.get(target, ()):
                        if other != wid:
                            rels.add((wid, other, SYNSET_RELATIONS[kind], sense_id))

    db.executemany("INSERT INTO senses VALUES (?,?,?,?,?,?,?,?,?)", rows)
    mark_concrete(db)
    db.executemany("INSERT INTO relations VALUES (?,?,?,?,'oewn')", sorted(rels))
    print("senses:", len(rows), "words with senses:", len({r[1] for r in rows}))
    for kind, n in db.execute("SELECT type, count(*) FROM relations GROUP BY type ORDER BY 2 DESC"):
        print(f"  {kind}: {n}")
    for reg, n in db.execute("SELECT register, count(*) FROM senses WHERE register IS NOT NULL GROUP BY 1"):
        print(f"  register {reg}: {n}")
