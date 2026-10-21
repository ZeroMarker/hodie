// 自动评分:客观题不让用户自评,由对错、耗时和拼写差异决定 FSRS 评分。规则见 docs/word-learning-plan.md。
import { type Grade, Rating } from "ts-fsrs";

export type Exercise = "choice" | "cloze" | "spell";

export const DEFAULT_MEDIAN_MS = 8000;

/** 编辑距离(Levenshtein)。 */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[’‘]/g, "'");
}

/** 拼写题的判定:完全一致为 0,否则返回与最接近的可接受形式之间的编辑距离。 */
export function spellingDistance(answer: string, accepted: string[]): number {
  const a = normalize(answer);
  return Math.min(...accepted.map((w) => editDistance(a, normalize(w))));
}

export interface GradeInput {
  exercise: Exercise;
  level: number;
  correct: boolean;
  /** 拼写题与正确答案的编辑距离,其他题型为 0 */
  distance: number;
  durationMs: number;
  /** 该用户同题型答对时耗时的中位数 */
  medianMs: number;
}

export function grade(g: GradeInput): Grade {
  const typed = g.exercise !== "choice";
  if (!g.correct) {
    // L3 拼写差一个字母记为 Hard,其他错误一律 Again
    return typed && g.distance === 1 ? Rating.Hard : Rating.Again;
  }
  if (g.durationMs > g.medianMs) return Rating.Hard;
  if (g.level >= 3 && g.durationMs <= g.medianMs / 2) return Rating.Easy;
  return Rating.Good;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return DEFAULT_MEDIAN_MS;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
