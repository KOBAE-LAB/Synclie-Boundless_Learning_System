import { describe, expect, it } from "vitest";
import { buildStatePrompt, buildSummaryPrompt } from "./discussion-wrapup";

describe("buildStatePrompt", () => {
  it("議題を含み、迷うときは『続ける』に倒す指示と、止めるかは人間が決める旨を含む", () => {
    const prompt = buildStatePrompt("光合成の速さ");
    expect(prompt).toContain("光合成の速さ");
    expect(prompt).toContain("迷うときはこれにする");
    expect(prompt).toContain("人間が決めます");
  });
  it("議題が未設定でも破綻しない", () => {
    expect(buildStatePrompt(null)).toContain("未設定");
  });
});

describe("buildSummaryPrompt", () => {
  it("議論に無い内容を足さない・結論を代わりに決めない・問いに答えを書かない、を指示する", () => {
    const prompt = buildSummaryPrompt({ objective: "x", learnerLevel: "中学校", materialText: "資料" });
    expect(prompt).toContain("議論に出ていない内容を付け足さない");
    expect(prompt).toContain("代わりに結論づけない");
    expect(prompt).toContain("答えを書かない");
    expect(prompt).toContain("中学校");
  });
  it("参考資料は長くても上限で切る", () => {
    const prompt = buildSummaryPrompt({ objective: null, learnerLevel: null, materialText: "あ".repeat(50000) });
    expect(prompt.length).toBeLessThan(6000);
  });
});
