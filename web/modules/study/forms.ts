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
