import { describe, expect, it } from "vitest";
import { isStageKey, shouldAdvanceToExpected, stageIndex, stagesUpTo } from "./stages";

describe("stagesUpTo(当時モードの検索範囲)", () => {
  it("その段階までを含む", () => {
    expect(stagesUpTo("analysis")).toEqual(["problem_setting", "information_gathering", "analysis"]);
  });
  it("段階が無ければ最初の段階だけ(先の記録を見せない側に倒す)", () => {
    expect(stagesUpTo(null)).toEqual(["problem_setting"]);
    expect(stagesUpTo("unknown")).toEqual(["problem_setting"]);
  });
});

describe("shouldAdvanceToExpected", () => {
  it("想定の段階がいまより先なら進める", () => {
    expect(shouldAdvanceToExpected("problem_setting", "analysis")).toBe(true);
    expect(shouldAdvanceToExpected(null, "problem_setting")).toBe(true);
  });
  it("同じか後ろなら進めない(自動では戻さない)", () => {
    expect(shouldAdvanceToExpected("analysis", "analysis")).toBe(false);
    expect(shouldAdvanceToExpected("expression", "problem_setting")).toBe(false);
  });
  it("想定の段階が無ければ何もしない", () => {
    expect(shouldAdvanceToExpected("analysis", null)).toBe(false);
  });
});

describe("isStageKey / stageIndex", () => {
  it("既定の4段階だけを受け付ける", () => {
    expect(isStageKey("expression")).toBe(true);
    expect(isStageKey("drop table")).toBe(false);
    expect(stageIndex("information_gathering")).toBe(1);
  });
});
