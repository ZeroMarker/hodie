// 从 ECDICT 中文释义里取出用于题目的简短释义。
import { splitTranslation } from "@/modules/vocab/card";

/** 释义行开头的词性标记归并为 n / v / a / r / other。 */
export function posTag(line: string): string {
  const m = /^([a-z]+)\./.exec(line.trim());
  if (!m) return "other";
  const t = m[1];
  if (t === "n") return "n";
  if (t === "v" || t === "vt" || t === "vi" || t === "aux") return "v";
  if (t === "a" || t === "adj" || t === "s") return "a";
  if (t === "ad" || t === "adv" || t === "r") return "r";
  return t;
}

// WordNet 词义 id 形如 oewn-bank__1.14.00..,下划线后第一位是 lexical 类别:1 名词、2 动词、3/5 形容词、4 副词。
const SENSE_POS: Record<string, string> = { "1": "n", "2": "v", "3": "a", "4": "r", "5": "a" };

export function sensePos(senseId: string | null): string | null {
  const m = /__(\d)\./.exec(senseId ?? "");
  return m ? (SENSE_POS[m[1]] ?? null) : null;
}

/** 取核心义对应词性的那一行(没有则取第一行普通释义),只保留前 3 个义项。 */
export function shortMeaning(translationZh: string | null, coreSenseId: string | null = null): string {
  // 去掉 [计]、[医] 等专业标注行和「xx的过去式」之类的变形说明
  const lines = splitTranslation(translationZh).filter(
    (l) => !/^\[/.test(l) && !/的(过去式|过去分词|现在分词|复数|第三人称)/.test(l),
  );
  if (lines.length === 0) return splitTranslation(translationZh)[0] ?? "";
  const pos = sensePos(coreSenseId);
  const line = (pos && lines.find((l) => posTag(l) === pos)) || lines[0];
  const m = /^([a-z]+\.)\s*(.*)$/.exec(line);
  const [prefix, body] = m ? [m[1] + " ", m[2]] : ["", line];
  const parts = body.split(/[,,;;]\s*/).filter(Boolean).slice(0, 3);
  return prefix + parts.join(", ");
}
