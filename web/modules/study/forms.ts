// ECDICT 的 exchange 字段记录词形变化,如 "p:went/d:gone/i:going/3:goes"。
export function wordForms(word: string, exchange: string | null): string[] {
  const forms = new Set([word]);
  for (const part of (exchange ?? "").split("/")) {
    const [k, v] = part.split(":");
    // 0 和 1 记录的是原形与变形类型,不是词形
    if (v && k !== "0" && k !== "1") forms.add(v);
  }
  return [...forms];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 在句子里找目标词的某个词形,返回挖空后的前后两段和被挖掉的词。 */
export function makeCloze(
  sentence: string,
  forms: string[],
): { before: string; after: string; answer: string } | null {
  // 长的词形优先,避免 go 先匹配到 going 的前缀
  const sorted = [...forms].sort((a, b) => b.length - a.length);
  for (const f of sorted) {
    const m = new RegExp(`(^|[^A-Za-z'-])(${escape(f)})(?![A-Za-z'-])`, "i").exec(sentence);
    if (m) {
      const start = m.index + m[1].length;
      return {
        before: sentence.slice(0, start),
        after: sentence.slice(start + m[2].length),
        answer: m[2],
      };
    }
  }
  return null;
}

/** 词形 → 拥有该词形的词书词 id(原形或变形)。 */
export type FormOwners = Map<string, number[]>;

export function buildFormOwners(rows: { id: number; word: string; exchange: string | null }[]): FormOwners {
  const owners: FormOwners = new Map();
  for (const r of rows) {
    for (const f of wordForms(r.word, r.exchange)) {
      const k = f.toLowerCase();
      const ids = owners.get(k);
      if (!ids) owners.set(k, [r.id]);
      else if (!ids.includes(r.id)) ids.push(r.id);
    }
  }
  return owners;
}

/**
 * 去掉同形异义的词形:某个词形同时属于另一个词书词(如 found 既是 found 的原形,
 * 又是 find 的过去式),句子里出现它时无法确定用的是哪个词。
 */
export function unambiguousForms(wordId: number, forms: string[], owners: FormOwners): string[] {
  return forms.filter((f) => (owners.get(f.toLowerCase()) ?? []).every((id) => id === wordId));
}

/**
 * 句子能否用来考这个词:按核心义写成的例句(AI 生成、WordNet 核心义例句)接受全部词形;
 * 其他例句(Tatoeba)只接受无歧义的词形。返回挖空结果,不能用时返回 null。
 */
export function clozeFor(
  sentence: string,
  senseMatched: boolean,
  wordId: number,
  forms: string[],
  owners: FormOwners,
): ReturnType<typeof makeCloze> {
  return makeCloze(sentence, senseMatched ? forms : unambiguousForms(wordId, forms, owners));
}
