import { describe, expect, it, vi } from "vitest";
import { buildGraph } from "@/modules/vocab/graph";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
const { listName, splitTranslation } = await import("@/modules/vocab/card");

describe("splitTranslation", () => {
  it("按换行拆分并去掉空行", () => {
    expect(splitTranslation("n. 银行\\nvt. 存款\n\n")).toEqual(["n. 银行", "vt. 存款"]);
  });
  it("空值返回空数组", () => {
    expect(splitTranslation(null)).toEqual([]);
  });
});

describe("listName", () => {
  it("词书代码转中文名", () => {
    expect(listName("cet4")).toBe("CET-4");
    expect(listName("unknown")).toBe("unknown");
  });
});

describe("graph", () => {
  const w = (id: number, word: string) => ({ id, word, gloss: "", inList: true });
  it("关系词连到中心词,同根词挂在词素下,重复的词只出现一次", () => {
    const g = buildGraph(
      { id: 1, word: "inspect" },
      {
        family: [w(2, "inspection")],
        synonyms: [w(3, "examine"), w(2, "inspection")],
        antonyms: [],
        hypernyms: [],
        morphemes: [
          { form: "-spect", kind: "suffix", meaning: "look", siblings: [w(4, "respect"), w(3, "examine")] },
          { form: "in-", kind: "prefix", meaning: "in", siblings: [] },
        ],
      },
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["w1", "w2", "w3", "m-spect", "w4"]);
    expect(g.edges).toContainEqual({ source: "m-spect", target: "w4", kind: "morpheme" });
    expect(g.edges.filter((e) => e.target === "w2")).toHaveLength(1);
  });
});
