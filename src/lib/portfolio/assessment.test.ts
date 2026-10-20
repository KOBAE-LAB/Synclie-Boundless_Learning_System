import { describe, expect, it } from "vitest";
import { fiscalYearOf, parseAssessmentInput, readAssessment } from "./assessment";

const now = new Date("2026-10-20T00:00:00Z");

describe("parseAssessmentInput", () => {
  it("段階(1〜4)とコメントを保存できる形にする", () => {
    expect(parseAssessmentInput({ rating: "3", comment: "  根拠を示せた  " }, now)).toEqual({
      rating: 3,
      comment: "根拠を示せた",
      updatedAt: now.toISOString(),
    });
  });
  it("コメントだけ・段階だけでも保存できる", () => {
    expect(parseAssessmentInput({ rating: "", comment: "メモ" }, now)).toMatchObject({ rating: null, comment: "メモ" });
    expect(parseAssessmentInput({ rating: "2", comment: "" }, now)).toMatchObject({ rating: 2, comment: "" });
  });
  it("範囲外・不正な段階は無視し、どちらも空なら null(評価を消す)", () => {
    expect(parseAssessmentInput({ rating: "9", comment: "" }, now)).toBeNull();
    expect(parseAssessmentInput({ rating: "abc", comment: "   " }, now)).toBeNull();
    expect(parseAssessmentInput({ rating: "0", comment: "x" }, now)).toMatchObject({ rating: null });
  });
  it("極端に長いコメントは上限で切る", () => {
    expect(parseAssessmentInput({ rating: "", comment: "あ".repeat(5000) }, now)?.comment).toHaveLength(1000);
  });
});

describe("readAssessment", () => {
  it("壊れた値・空の値は null", () => {
    expect(readAssessment(null)).toBeNull();
    expect(readAssessment("x")).toBeNull();
    expect(readAssessment({ rating: 99, comment: "" })).toBeNull();
  });
  it("正しい値はそのまま読める", () => {
    expect(readAssessment({ rating: 4, comment: "ok", updatedAt: "t" })).toEqual({ rating: 4, comment: "ok", updatedAt: "t" });
  });
});

describe("fiscalYearOf(日本の年度、4月始まり・日本時間)", () => {
  it("4月〜12月はその年、1〜3月は前の年", () => {
    expect(fiscalYearOf("2026-04-01T00:00:00+09:00")).toBe(2026);
    expect(fiscalYearOf("2026-10-20T10:00:00+09:00")).toBe(2026);
    expect(fiscalYearOf("2027-03-31T23:59:00+09:00")).toBe(2026);
    expect(fiscalYearOf("2027-01-05T10:00:00+09:00")).toBe(2026);
  });
  it("年度の境目は、日本時間で判定する(UTCの3/31 16:00は、日本時間の4/1 1:00=新年度)", () => {
    expect(fiscalYearOf("2026-03-31T16:00:00Z")).toBe(2026);
    expect(fiscalYearOf("2026-03-31T14:59:00Z")).toBe(2025);
  });
});
