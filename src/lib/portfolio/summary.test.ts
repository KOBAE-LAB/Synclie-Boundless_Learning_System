import { describe, expect, it } from "vitest";
import { summarizePortfolio } from "./summary";
import type { PortfolioEntry } from "./types";

const e = (id: string, createdAt: string, over: Partial<PortfolioEntry> = {}): PortfolioEntry => ({
  submissionId: id, courseId: "c1", courseTitle: "理科", createdAt, fiscalYear: 2026, content: "x",
  selfAssessment: null, teacherAssessment: null, shared: false, feedback: [], judgment: null, reflection: null, discussion: null,
  ...over,
});

describe("summarizePortfolio", () => {
  it("件数と、新しい順の最新3件を数える", () => {
    const s = summarizePortfolio([
      e("a", "2026-10-01T00:00:00Z", { selfAssessment: { rating: 3, comment: "", updatedAt: "" } }),
      e("b", "2026-10-03T00:00:00Z", { teacherAssessment: { rating: null, comment: "良い", updatedAt: "" }, shared: true }),
      e("c", "2026-10-02T00:00:00Z", { courseId: "c2" }),
      e("d", "2026-10-04T00:00:00Z"),
    ]);
    expect(s).toMatchObject({ total: 4, withoutSelfAssessment: 3, withTeacherComment: 1, shared: 1, courseCount: 2 });
    expect(s.latest.map((x) => x.submissionId)).toEqual(["d", "b", "c"]);
  });
  it("空でも動く", () => {
    expect(summarizePortfolio([])).toMatchObject({ total: 0, latest: [] });
  });
});
