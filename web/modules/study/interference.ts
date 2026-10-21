// 新词的干扰控制:同一天的新词避开形近词、同义或近义词、同类词(共同上位词)。
import { editDistance } from "./grade";

export interface Candidate {
  id: number;
  word: string;
}

export function similarForm(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return Math.abs(x.length - y.length) <= 1 && editDistance(x, y) <= 2;
}

/**
 * 按顺序挑出至多 n 个互不冲突的新词。
 * taken:今天已经学过的词(新挑的词也不能与它们冲突);
 * related:同义或近义的词对;hypernyms:词 → 上位词集合。
 */
export function pickNonInterfering(
  candidates: Candidate[],
  n: number,
  taken: Candidate[],
  related: Map<number, Set<number>>,
  hypernyms: Map<number, Set<number>>,
): Candidate[] {
  const chosen: Candidate[] = [];
  const pool = [...taken];
  for (const c of candidates) {
    if (chosen.length >= n) break;
    const conflict = pool.some(
      (p) =>
        similarForm(p.word, c.word) ||
        related.get(c.id)?.has(p.id) ||
        related.get(p.id)?.has(c.id) ||
        shares(hypernyms.get(c.id), hypernyms.get(p.id)),
    );
    if (conflict) continue;
    chosen.push(c);
    pool.push(c);
  }
  return chosen;
}

function shares(a?: Set<number>, b?: Set<number>): boolean {
  if (!a || !b) return false;
  for (const x of a) if (b.has(x)) return true;
  return false;
}
