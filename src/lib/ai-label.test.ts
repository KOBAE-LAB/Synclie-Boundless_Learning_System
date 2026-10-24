import { describe, expect, it } from "vitest";
import { withAiLabel } from "./ai-label";

describe("withAiLabel", () => {
  it("名前に(AI)を付ける", () => {
    expect(withAiLabel("ハルカ")).toBe("ハルカ(AI)");
  });
  it("先輩型・集約型は、すでに末尾が(AI)なので重ねない", () => {
    expect(withAiLabel("2025年度の先輩 ミナト(AI)")).toBe("2025年度の先輩 ミナト(AI)");
    expect(withAiLabel("2025年度のみんな(AI)")).toBe("2025年度のみんな(AI)");
  });
});
