import { describe, expect, it } from "vitest";
import { renderHtml, renderJson, renderMarkdown } from "./render";
import { toSharedView } from "./load";
import type { Portfolio, PortfolioEntry } from "./types";

const entry = (over: Partial<PortfolioEntry> = {}): PortfolioEntry => ({
  submissionId: "s1",
  courseId: "c1",
  courseTitle: "理科",
  createdAt: "2026-10-20T01:00:00Z",
  fiscalYear: 2026,
  content: "成果の本文",
  selfAssessment: { rating: 3, comment: "自分では出来た", updatedAt: "" },
  teacherAssessment: { rating: null, comment: "先生のコメント", updatedAt: "" },
  shared: true,
  feedback: [{ criteriaLabel: "根拠", goodPoints: "良い", nextQuestion: "なぜ?" }],
  judgment: { logicStructure: 4, evidenceQuality: 3, rebuttalResponse: 2, summaryComment: "総評" },
  reflection: { whatLearned: "学び", whatConfused: "迷い", nextGoal: "次" },
  discussion: { summary: "まとめ", keyPoints: ["要点1"], nextQuestions: ["問い1"] },
  ...over,
});
const portfolio = (entries: PortfolioEntry[]): Portfolio => ({ learnerName: "花子", generatedAt: "2026-10-20T00:00:00Z", entries });

describe("renderHtml", () => {
  it("利用者の入力をエスケープする(スクリプト混入を防ぐ)", () => {
    const html = renderHtml(portfolio([entry({ content: '<script>alert(1)</script>"', courseTitle: "<img src=x onerror=1>" })]));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it("AI評価には非最終の注記が付く", () => {
    expect(renderHtml(portfolio([entry()]))).toContain("最終ではなく");
  });
  it("noindexを付ける", () => {
    expect(renderHtml(portfolio([]))).toContain('name="robots" content="noindex"');
  });
});

describe("renderMarkdown / renderJson", () => {
  it("年度の見出しと内容を含む", () => {
    const md = renderMarkdown(portfolio([entry()]));
    expect(md).toContain("## 2026年度");
    expect(md).toContain("自己評価");
    expect(md).toContain("教師のコメント");
  });
  it("JSONは読み戻せる", () => {
    const parsed = JSON.parse(renderJson(portfolio([entry()])));
    expect(parsed.format).toBe("synclie-portfolio");
    expect(parsed.entries).toHaveLength(1);
  });
});

describe("toSharedView", () => {
  it("公開用に選んだ成果だけを残し、振り返り・AIフィードバックは外す", () => {
    const view = toSharedView(portfolio([entry({ shared: true }), entry({ submissionId: "s2", shared: false })]));
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].reflection).toBeNull();
    expect(view.entries[0].feedback).toEqual([]);
    expect(view.entries[0].judgment).toBeNull();
    expect(view.entries[0].teacherAssessment).not.toBeNull();
  });
});
