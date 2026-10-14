"""从 Wiktionary 官方 dump 导入词源和词根词缀。

只解析 words 表中词条的 ==English== 段落。每个 Etymology 小节产出:
- etymologies:去掉模板后的纯文本说明;
- etymology_steps:来源链,如 inspect ← la inspectum ← la inspicio;
- morphemes / word_morphemes:来自 af、affix、prefix、suffix、confix、compound 模板的构词拆分。
语言代码到名称的映射取自 dump 里的 Module:languages 数据模块。
"""

import bz2
import gzip
import json
import re
import xml.etree.ElementTree as ET

FILE = "enwiktionary-20261001-pages-articles.xml.bz2"
NS = "{http://www.mediawiki.org/xml/export-0.11/}"

LANG_MODULES = (
    "Module:languages/code to canonical name",
    "Module:etymology languages/code to canonical name",
)
STEP_TYPES = {
    "inh": "inherited", "inh+": "inherited", "inherited": "inherited",
    "bor": "borrowed_from", "bor+": "borrowed_from", "borrowed": "borrowed_from", "lbor": "borrowed_from",
    "der": "derived_from", "der+": "derived_from", "derived": "derived_from", "uder": "derived_from",
}
# 来源链中后续环节常写成 {{m|la|...}},只在 from 之后出现时算作下一步
MENTION = {"m", "m+", "l", "mention"}
AFFIX = {"af", "affix", "prefix", "pre", "suffix", "suf", "confix", "con", "compound", "com"}
DROP = {"root", "etymon", "ety", "wikidata lexeme", "rfe", "etystub", "PIE word", "dercat", "C"}
LANG_ENTRY_RE = re.compile(r'\["([^"]+)"\]\s*=\s*"([^"]+)"')
TEMPLATE_RE = re.compile(r"\{\{([^{}]*)\}\}")
HEADING_RE = re.compile(r"^(=+)\s*([^=]+?)\s*\1\s*$", re.M)

SCHEMA = """
CREATE TABLE languages (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE etymologies (
    word_id INTEGER NOT NULL REFERENCES words(id),
    etym_no INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (word_id, etym_no)
);
CREATE TABLE etymology_steps (
    word_id INTEGER NOT NULL REFERENCES words(id),
    etym_no INTEGER NOT NULL,
    step INTEGER NOT NULL,
    type TEXT NOT NULL,
    lang TEXT NOT NULL,
    term TEXT NOT NULL,
    gloss TEXT,
    PRIMARY KEY (word_id, etym_no, step)
);
CREATE TABLE morphemes (
    id INTEGER PRIMARY KEY,
    form TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    source_lang TEXT,
    meaning TEXT
);
CREATE TABLE word_morphemes (
    word_id INTEGER NOT NULL REFERENCES words(id),
    etym_no INTEGER NOT NULL,
    position INTEGER NOT NULL,
    morpheme_id INTEGER NOT NULL REFERENCES morphemes(id),
    gloss TEXT,
    PRIMARY KEY (word_id, etym_no, position)
);
"""


def parse_template(body):
    """返回 (名称, 位置参数, 命名参数);位置参数里的 <t:...> 内联修饰并入命名参数。"""
    parts = body.split("|")
    name = parts[0].strip()
    pos, named = [], {}
    for p in parts[1:]:
        key, eq, value = p.partition("=")
        if eq and re.fullmatch(r"[a-z0-9]+", key.strip()):
            named[key.strip()] = value.strip()
            continue
        inline = {}
        for k, v in re.findall(r"<(\w+):([^<>]*)>", p):
            inline[k] = v
        pos.append((re.sub(r"<[^<>]*>", "", p).strip(), inline))
    return name, pos, named


def gloss_of(named, inline, pos, index):
    g = inline.get("t") or inline.get("gloss") or named.get("t") or named.get("gloss")
    if not g and len(pos) > index:
        g = pos[index][0]
    return g or None


class Section:
    def __init__(self, langs):
        self.langs = langs
        self.steps = []  # (type, lang, term, gloss)
        self.affixes = []  # (form, lang, gloss)
        self.record = True  # 来源链只取第一段,后面的段落多是补充说明

    def render(self, match):
        name, pos, named = parse_template(match.group(1))
        lang_name = lambda code: self.langs.get(code, code)  # noqa: E731
        if name in DROP or name.startswith("R:"):
            return ""
        if name in STEP_TYPES and len(pos) >= 3:
            code, (term, inline) = pos[1][0], pos[2]
            gloss = gloss_of(named, inline, pos, 4)
            if self.record and term and term != "-":
                self.steps.append((STEP_TYPES[name], code, term, gloss))
            return f"{lang_name(code)} {term}" + (f"(“{gloss}”)" if gloss else "") if term and term != "-" else lang_name(code)
        if name in MENTION and len(pos) >= 2:
            code, (term, inline) = pos[0][0], pos[1]
            gloss = gloss_of(named, inline, pos, 3)
            alt = pos[2][0] if len(pos) > 2 and pos[2][0] else term
            after_from = re.search(r"\bfrom\s*$", match.string[max(0, match.start() - 12): match.start()])
            component = re.match(r"\s*\+", match.string[match.end():])  # in + specere 是构词成分,不是来源
            if self.record and self.steps and after_from and not component and code != "en" and term:
                self.steps.append(("derived_from", code, term, gloss))
            return f"{lang_name(code)} {alt}" + (f"(“{gloss}”)" if gloss else "") if code != "en" else alt
        if name in {"cog", "cognate", "noncog", "ncog"} and len(pos) >= 2:
            return f"{lang_name(pos[0][0])} {pos[1][0]}"
        if name in AFFIX and len(pos) >= 2:
            items = pos[1:]
            if name in {"prefix", "pre"} and items:
                items = [(items[0][0].rstrip("-") + "-", items[0][1])] + items[1:]
            if name in {"suffix", "suf"} and len(items) >= 2:
                items = items[:1] + [("-" + i[0].lstrip("-"), i[1]) for i in items[1:]]
            if name in {"confix", "con"} and len(items) >= 2:
                items = [(items[0][0].rstrip("-") + "-", items[0][1])] + items[1:-1] + [("-" + items[-1][0].lstrip("-"), items[-1][1])]
            lang = pos[0][0]
            forms = [(f, lang, inline.get("t") or named.get(f"t{i}") or named.get(f"gloss{i}")) for i, (f, inline) in enumerate(items, 1) if f]
            if self.record and not self.affixes:
                self.affixes = forms
            return " + ".join(f for f, _, _ in forms)
        if name in {"w", "pedia", "lang", "q", "qualifier", "i", "gloss", "gl", "n-g", "ng", "ngd", "non-gloss", "non-gloss definition"} and pos:
            return pos[-1][0]
        return ""

    def text(self, body):
        paragraphs = [p for p in re.split(r"\n\s*\n", body) if p.strip()]
        out = []
        for i, p in enumerate(paragraphs):
            self.record = i == 0
            out.append(self.paragraph(p))
        return " ".join(t for t in out if t)

    def paragraph(self, body):
        body = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->", "", body, flags=re.S)
        prev = None
        while prev != body:  # 由内向外展开嵌套模板
            prev = body
            body = TEMPLATE_RE.sub(self.render, body)
        body = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", body)
        body = re.sub(r"'{2,}", "", body)
        body = re.sub(r"\s+", " ", body)
        body = re.sub(r"\(\s*\)|\s+(?=[.,;:])", "", body)  # 模板去掉后留下的空括号和标点前空格
        return re.sub(r"([.,;:])(?:\s*[.,;:])+", r"\1", body).strip()


def english_section(wikitext):
    m = re.search(r"^==\s*English\s*==\s*$", wikitext, re.M)
    if not m:
        return None
    end = re.search(r"^==[^=].*==\s*$", wikitext[m.end():], re.M)
    return wikitext[m.end(): m.end() + end.start()] if end else wikitext[m.end():]


def etymology_sections(english):
    heads = list(HEADING_RE.finditer(english))
    for i, h in enumerate(heads):
        m = re.fullmatch(r"Etymology(?:\s+(\d+))?", h.group(2))
        if m:
            end = heads[i + 1].start() if i + 1 < len(heads) else len(english)
            yield int(m.group(1) or 1), english[h.end(): end]


def iter_pages(path):
    for _, el in ET.iterparse(bz2.open(path), events=("end",)):
        if el.tag == NS + "page":
            title = el.findtext(NS + "title")
            text = el.findtext(f"{NS}revision/{NS}text") or ""
            el.clear()
            yield title, text


def first_definition(english):
    """取第一条释义行(# 开头),去掉模板和链接。"""
    for line in english.splitlines():
        if re.match(r"#\s", line):
            text = Section({}).paragraph(line[1:])
            if re.search(r"\w", text):  # 跳过只有标签模板的行
                return text
    return None


def fill_morphemes(db, pages, morpheme_ids, langs):
    """从 in-、-spect 这类词缀页面取原义和来源语言。"""
    rows = []
    for form, mid in morpheme_ids.items():
        english = pages.get(form) or pages.get(form.strip("-"))
        if not english:
            continue
        source = None
        for _, body in etymology_sections(english):
            sec = Section(langs)
            sec.text(body)
            source = sec.steps[0][1] if sec.steps else None
            break
        rows.append((source, first_definition(english), mid))
    db.executemany("UPDATE morphemes SET source_lang = coalesce(source_lang, ?), meaning = ? WHERE id = ?", rows)


def extract(raw, word_ids):
    """扫描 dump 要十几分钟,抽出的语言表和英文段落缓存到 data/build;换 dump 或词表变化时自动重扫。"""
    cache = raw.parent / "build" / "wiktionary-en.json.gz"
    if cache.exists():
        data = json.load(gzip.open(cache, "rt", encoding="utf-8"))
        if data["file"] == FILE and set(word_ids) <= set(data["titles"]):
            return data["langs"], data["pages"]
    langs, pages = {}, {}
    for title, text in iter_pages(raw / FILE):
        if title in LANG_MODULES:
            langs.update(LANG_ENTRY_RE.findall(text))
        elif title in word_ids or title.startswith("-") or title.endswith("-"):
            english = english_section(text)
            if english:
                pages[title] = english
    with gzip.open(cache, "wt", encoding="utf-8") as f:
        json.dump({"file": FILE, "titles": sorted(word_ids), "langs": langs, "pages": pages}, f, ensure_ascii=False)
    return langs, pages


def load(db, raw):
    db.executescript(SCHEMA)
    word_ids = {w: i for i, w in db.execute("SELECT id, word FROM words")}
    langs, pages = extract(raw, word_ids)
    db.executemany("INSERT INTO languages VALUES (?, ?)", sorted(langs.items()))

    morpheme_ids = {}
    ety_rows, step_rows, wm_rows = [], [], []
    for title, english in pages.items():
        wid = word_ids.get(title)
        if wid is None:  # 词缀页面,只用于填 morphemes
            continue
        # 同一页面的 Etymology 编号可能重复(按词性分组时各自写 Etymology),按出现顺序重编
        for etym_no, (_, body) in enumerate(etymology_sections(english), 1):
            sec = Section(langs)
            text = sec.text(body)
            if text:
                ety_rows.append((wid, etym_no, text))
            step_rows += [(wid, etym_no, i, *s) for i, s in enumerate(sec.steps, 1)]
            for position, (form, lang, gloss) in enumerate(sec.affixes, 1):
                kind = "prefix" if form.endswith("-") else "suffix" if form.startswith("-") else "root"
                if form not in morpheme_ids:
                    # 非英语模板(如 biology 的 {{af|grc|βίος|-λογία}})直接记来源语言
                    morpheme_ids[form] = db.execute(
                        "INSERT INTO morphemes (form, kind, source_lang) VALUES (?, ?, ?)",
                        (form, kind, None if lang == "en" else lang)).lastrowid
                wm_rows.append((wid, etym_no, position, morpheme_ids[form], gloss))
    fill_morphemes(db, pages, morpheme_ids, langs)
    db.executemany("INSERT INTO etymologies VALUES (?,?,?)", ety_rows)
    db.executemany("INSERT OR IGNORE INTO etymology_steps VALUES (?,?,?,?,?,?,?)", step_rows)
    db.executemany("INSERT OR IGNORE INTO word_morphemes VALUES (?,?,?,?,?)", wm_rows)
    print("languages:", len(langs), "pages:", len(pages), "etymologies:", len(ety_rows),
          "steps:", len(step_rows), "morphemes:", len(morpheme_ids), "word_morphemes:", len(wm_rows))
