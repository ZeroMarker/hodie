import { describe, expect, it, vi } from "vitest";

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
