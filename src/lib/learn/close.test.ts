import { describe, expect, it } from "vitest";
import { decideEndReason } from "./close";

describe("decideEndReason", () => {
  it("制限時間を過ぎていれば、AIの提案の有無にかかわらず time_limit", () => {
    expect(decideEndReason({ isOverTime: true, closeSuggestedAt: null })).toBe("time_limit");
    expect(decideEndReason({ isOverTime: true, closeSuggestedAt: "2026-10-20T10:00:00Z" })).toBe("time_limit");
  });
  it("時間内でAIが提案済みなら ai_suggested", () => {
    expect(decideEndReason({ isOverTime: false, closeSuggestedAt: "2026-10-20T10:00:00Z" })).toBe("ai_suggested");
  });
  it("どちらでもなければ、本人が自分から終えた(student)", () => {
    expect(decideEndReason({ isOverTime: false, closeSuggestedAt: null })).toBe("student");
  });
});
