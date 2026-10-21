// FSRS 调度和题型级别。只在服务端运行,输入卡片状态和评分,输出新状态。
import { type Card, createEmptyCard, fsrs, type Grade, State } from "ts-fsrs";
import type { Exercise } from "./grade";

export { Rating, State } from "ts-fsrs";

/** 数据库里卡片的 FSRS 字段。 */
export interface CardState {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  learningSteps: number;
  lastReview: Date | null;
}

export const MASTERED_STABILITY = 21;

export function newCardState(now: Date): CardState {
  return fromFsrs(createEmptyCard(now));
}

function toFsrs(c: CardState): Card {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.lastReview ?? undefined,
  };
}

function fromFsrs(c: Card): CardState {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    learningSteps: c.learning_steps,
    lastReview: c.last_review ?? null,
  };
}

export function schedule(
  card: CardState,
  rating: Grade,
  now: Date,
  retention = 0.9,
  params?: number[] | null,
): CardState {
  const f = fsrs({ request_retention: retention, enable_fuzz: false, ...(params ? { w: params } : {}) });
  return fromFsrs(f.next(toFsrs(card), now, rating).card);
}

/** 题型阶梯:按稳定性 S(天)定级别。L0 是新词展示,L4 在阶段 3 接入 AI 前按 L3 出题。 */
export function levelFor(card: CardState): number {
  if (card.state === State.New) return 0;
  const s = card.stability;
  if (s < 2) return 1;
  if (s < 7) return 2;
  if (s < 30) return 3;
  return 4;
}

export function exerciseFor(level: number): Exercise {
  if (level <= 1) return "choice";
  if (level === 2) return "cloze";
  return "spell";
}
