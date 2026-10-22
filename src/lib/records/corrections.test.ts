import { describe, expect, it } from "vitest";
import { overlayCorrections, pickLatestCorrections, type CorrectionRow } from "./corrections";

const row = (turn_id: string, corrected_content: string, created_at: string): CorrectionRow => ({
  turn_id,
  corrected_content,
  note: null,
  created_at,
});

describe("pickLatestCorrections", () => {
  it("発言ごとに、いちばん新しい修正版だけを残す(並び順に依存しない)", () => {
    const latest = pickLatestCorrections([
      row("t1", "2回目", "2026-10-21T02:00:00Z"),
      row("t1", "1回目", "2026-10-21T01:00:00Z"),
      row("t2", "t2の修正", "2026-10-21T01:30:00Z"),
    ]);
    expect(latest.get("t1")?.corrected_content).toBe("2回目");
    expect(latest.get("t2")?.corrected_content).toBe("t2の修正");
  });
});

describe("overlayCorrections", () => {
  it("修正版がある発言だけ本文を差し替え、元の行は変えない(生ログは書き換えない)", () => {
    const turns = [
      { id: "t1", content: "元の発言", speaker_type: "persona" },
      { id: "t2", content: "学習者の発言", speaker_type: "student" },
    ];
    const shown = overlayCorrections(turns, pickLatestCorrections([row("t1", "直した発言", "2026-10-21T01:00:00Z")]));
    expect(shown.map((t) => t.content)).toEqual(["直した発言", "学習者の発言"]);
    expect(turns[0].content).toBe("元の発言");
  });
});
