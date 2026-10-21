import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
import { addDays, dayEnd, streak, studyDay } from "@/modules/study/day";
import { makeCloze, wordForms } from "@/modules/study/forms";
import { editDistance, grade, median, spellingDistance } from "@/modules/study/grade";
import { pickNonInterfering, similarForm } from "@/modules/study/interference";
import { posTag, sensePos, shortMeaning } from "@/modules/study/meaning";
import { finished, masteredCutoff } from "@/modules/study/placement-rules";
import { Rating, State, exerciseFor, levelFor, newCardState, schedule } from "@/modules/study/schedule";

describe("meaning", () => {
  it("词性标记归并", () => {
    expect(posTag("vt. 使适应")).toBe("v");
    expect(posTag("a. 好的")).toBe("a");
    expect(posTag("[医] 库")).toBe("other");
  });
  it("从 sense id 取词性", () => {
    expect(sensePos("oewn-adapt__2.30.01..")).toBe("v");
    expect(sensePos("oewn-fine__5.00.00.satisfactory.00")).toBe("a");
    expect(sensePos(null)).toBeNull();
  });
  it("按核心义词性取释义,最多 3 个义项", () => {
    const zh = "n. 罚款, 罚金\na. 好的, 精美的, 细的, 晴朗的\n[医] 细的";
    expect(shortMeaning(zh, "oewn-fine__5.00.00.satisfactory.00")).toBe("a. 好的, 精美的, 细的");
    expect(shortMeaning(zh, null)).toBe("n. 罚款, 罚金");
  });
  it("跳过变形说明行", () => {
    expect(shortMeaning("run的过去式和过去分词\nvi. 跑", null)).toBe("vi. 跑");
  });
});

describe("grade", () => {
  const base = { exercise: "choice" as const, level: 1, correct: true, distance: 0, medianMs: 4000 };
  it("答错为 Again", () => {
    expect(grade({ ...base, correct: false, durationMs: 1000 })).toBe(Rating.Again);
  });
  it("拼写差一个字母为 Hard", () => {
    expect(grade({ ...base, exercise: "spell", level: 3, correct: false, distance: 1, durationMs: 1000 })).toBe(
      Rating.Hard,
    );
  });
  it("答对按耗时分 Hard / Good / Easy", () => {
    expect(grade({ ...base, durationMs: 5000 })).toBe(Rating.Hard);
    expect(grade({ ...base, durationMs: 1000 })).toBe(Rating.Good);
    expect(grade({ ...base, exercise: "spell", level: 3, durationMs: 1000 })).toBe(Rating.Easy);
  });
  it("编辑距离与中位数", () => {
    expect(editDistance("adapt", "adopt")).toBe(1);
    expect(spellingDistance(" Went ", ["go", "went"])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("schedule", () => {
  const now = new Date("2026-10-21T02:00:00Z");
  it("新卡为 L0,答对后进入学习状态", () => {
    const c = newCardState(now);
    expect(levelFor(c)).toBe(0);
    const next = schedule(c, Rating.Good, now);
    expect(next.state).not.toBe(State.New);
    expect(next.reps).toBe(1);
    expect(next.due.getTime()).toBeGreaterThan(now.getTime());
  });
  it("按稳定性定级别和题型", () => {
    const c = { ...newCardState(now), state: State.Review };
    expect(levelFor({ ...c, stability: 1 })).toBe(1);
    expect(levelFor({ ...c, stability: 3 })).toBe(2);
    expect(levelFor({ ...c, stability: 10 })).toBe(3);
    expect(exerciseFor(1)).toBe("choice");
    expect(exerciseFor(2)).toBe("cloze");
    expect(exerciseFor(4)).toBe("spell");
  });
  it("Again 增加遗忘次数", () => {
    let c = newCardState(now);
    c = schedule(c, Rating.Good, now);
    c = schedule(c, Rating.Good, new Date(now.getTime() + 86400_000));
    c = schedule(c, Rating.Good, new Date(now.getTime() + 5 * 86400_000));
    const lapsed = schedule(c, Rating.Again, new Date(now.getTime() + 30 * 86400_000));
    expect(lapsed.lapses).toBe(c.lapses + 1);
  });
});

describe("interference", () => {
  it("形近词", () => {
    expect(similarForm("adapt", "adopt")).toBe(true);
    expect(similarForm("cat", "category")).toBe(false);
  });
  it("跳过与已选词冲突的候选", () => {
    const cands = [
      { id: 1, word: "adapt" },
      { id: 2, word: "adopt" },
      { id: 3, word: "big" },
      { id: 4, word: "large" },
      { id: 5, word: "apple" },
      { id: 6, word: "banana" },
      { id: 7, word: "river" },
    ];
    const related = new Map([[3, new Set([4])]]);
    const hyper = new Map([
      [5, new Set([100])],
      [6, new Set([100])],
    ]);
    const picked = pickNonInterfering(cands, 10, [{ id: 9, word: "rivet" }], related, hyper);
    expect(picked.map((p) => p.id)).toEqual([1, 3, 5]);
  });
});

describe("forms", () => {
  it("解析 exchange", () => {
    expect(wordForms("go", "p:went/d:gone/i:going/3:goes/0:go/1:p")).toEqual(["go", "went", "gone", "going", "goes"]);
  });
  it("挖空匹配完整词形", () => {
    expect(makeCloze("She is going home.", ["go", "going"])).toEqual({ before: "She is ", after: " home.", answer: "going" });
    expect(makeCloze("Good morning.", ["go"])).toBeNull();
  });
});

describe("placement", () => {
  const r = (band: number, known: number) => ({ band, known, total: 5 });
  it("从第 1 档起连续通过至少两档才跳过", () => {
    expect(masteredCutoff([r(1, 5), r(2, 5), r(3, 3), r(4, 5)])).toBe(2000);
    expect(masteredCutoff([r(1, 5), r(2, 4)])).toBe(0);
    expect(masteredCutoff([r(2, 5), r(3, 5)])).toBe(0);
  });
  it("连续两档未通过就结束", () => {
    expect(finished([r(1, 5), r(2, 3)])).toBe(false);
    expect(finished([r(1, 5), r(2, 3), r(3, 2)])).toBe(true);
  });
});

describe("day", () => {
  it("北京时间凌晨 4 点切换学习日", () => {
    expect(studyDay(new Date("2026-10-20T19:59:00Z"))).toBe("2026-10-20");
    expect(studyDay(new Date("2026-10-20T20:00:00Z"))).toBe("2026-10-21");
    expect(dayEnd(new Date("2026-10-21T02:00:00Z")).toISOString()).toBe("2026-10-21T20:00:00.000Z");
  });
  it("连续打卡", () => {
    const today = "2026-10-21";
    expect(streak(["2026-10-21", "2026-10-20", "2026-10-18"], today)).toBe(2);
    expect(streak(["2026-10-20", "2026-10-19"], today)).toBe(2);
    expect(streak(["2026-10-19"], today)).toBe(0);
    expect(addDays(today, 1)).toBe("2026-10-22");
  });
});
