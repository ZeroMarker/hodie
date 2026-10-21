// 词汇量测试:按词频排名每 1000 个词分一档,每档 5 道释义选择题。
export const BAND_SIZE = 1000;
export const BAND_QUESTIONS = 5;
export const MAX_BANDS = 10;
export const PASS_RATE = 0.9;

export interface BandResult {
  band: number;
  known: number;
  total: number;
}

export function passed(r: BandResult): boolean {
  return r.total > 0 && r.known / r.total >= PASS_RATE;
}

/** 测试何时结束:连续两档未通过,或测完全部档位。 */
export function finished(results: BandResult[]): boolean {
  if (results.length >= MAX_BANDS) return true;
  const last2 = results.slice(-2);
  return last2.length === 2 && last2.every((r) => !passed(r));
}

/**
 * 已掌握的词频排名上限:从第 1 档起连续通过的档位整体跳过,但至少要连续通过两档才生效。
 * 返回 0 表示不跳过。
 */
export function masteredCutoff(results: BandResult[]): number {
  const sorted = [...results].sort((a, b) => a.band - b.band);
  let k = 0;
  for (const r of sorted) {
    if (r.band !== k + 1 || !passed(r)) break;
    k = r.band;
  }
  return k >= 2 ? k * BAND_SIZE : 0;
}
