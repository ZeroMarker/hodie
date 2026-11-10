// 自适应:每天按最近 7 天的复习表现调整新词数和题型比例。规则见 docs/word-learning-plan.md 的「自适应」。
import type { Exercise } from "./grade";
import { LISTEN_RATE } from "./schedule";

export const MIN_DAILY_NEW = 5;
export const MAX_DAILY_NEW = 20;
/** 复习样本少于这个数时不调整新词数(积压除外)。 */
export const MIN_REVIEWS = 20;
/** 单个题型样本少于这个数时不判断它是否偏难。 */
export const MIN_EXERCISE_REVIEWS = 10;
export const BOOST_DAYS = 3;

/** 某题型最近 7 天的复习作答数和答错数(评分为 Again)。 */
export type ExerciseStat = {
  exercise: Exercise;
  total: number;
  wrong: number;
};

/** 题型加倍的截止日(不含),如 { dictation: "2026-11-13" }。 */
export type Boosts = Partial<Record<Exercise, string>>;

export interface AdaptInput {
  dailyNew: number;
  stats: ExerciseStat[];
  /** 今天之前就已到期、还没复习的卡片数 */
  overdue: number;
  today: string;
  boosts: Boosts;
}

export interface AdaptResult {
  dailyNew: number;
  boosts: Boosts;
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export function adapt(a: AdaptInput): AdaptResult {
  const total = a.stats.reduce((n, s) => n + s.total, 0);
  const wrong = a.stats.reduce((n, s) => n + s.wrong, 0);
  const accuracy = total ? 1 - wrong / total : 1;

  // 复习没完成(有积压)或正确率低于 80% 时减 3;正确率高于 92% 且没有积压时加 2
  let dailyNew = a.dailyNew;
  if (a.overdue > 0 || (total >= MIN_REVIEWS && accuracy < 0.8)) dailyNew -= 3;
  else if (total >= MIN_REVIEWS && accuracy > 0.92) dailyNew += 2;
  dailyNew = Math.min(MAX_DAILY_NEW, Math.max(MIN_DAILY_NEW, dailyNew));

  // 错误率比平均高 15 个百分点以上的题型加倍出现 3 天;过期的加倍去掉
  const boosts: Boosts = {};
  for (const [e, until] of Object.entries(a.boosts) as [Exercise, string][]) {
    if (until > a.today) boosts[e] = until;
  }
  const avgErr = total ? wrong / total : 0;
  for (const s of a.stats) {
    if (s.total >= MIN_EXERCISE_REVIEWS && s.wrong / s.total > avgErr + 0.15) {
      boosts[s.exercise] = addDays(a.today, BOOST_DAYS);
    }
  }
  return { dailyNew, boosts };
}

/**
 * 听力题(听音选义、听写)在 L1 和 L3 中的比例。默认 LISTEN_RATE;
 * 听力题加倍时比例翻倍,对应的看词题加倍时听力题减为 0;两者都加倍时不变。
 */
export function listenRate(level: number, boosts: Boosts, today: string): number {
  const active = (e: Exercise) => (boosts[e] ?? "") > today;
  const [listen, visual]: Exercise[] = level <= 1 ? ["listen", "choice"] : ["dictation", "spell"];
  const up = active(listen);
  const down = active(visual);
  if (up && !down) return Math.min(1, LISTEN_RATE * 2);
  if (down && !up) return Math.max(0, 1 - (1 - LISTEN_RATE) * 2);
  return LISTEN_RATE;
}
