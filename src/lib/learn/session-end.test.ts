import { describe, expect, it } from "vitest";
import { formatClock, getTimeStatus, shouldJudgeDiscussionState, statusFromElapsed } from "./session-end";

const start = "2026-10-20T10:00:00Z";
const at = (minutes: number) => new Date(new Date(start).getTime() + minutes * 60 * 1000);

describe("getTimeStatus", () => {
  it("制限時間が無ければ、何も制限しない", () => {
    expect(getTimeStatus({ startedAt: start, limitMinutes: null, policy: "hard", now: at(999) })).toMatchObject({
      hasLimit: false,
      isOver: false,
      blocksInput: false,
    });
  });

  it("制限時間内は、残り時間を返し、入力は止めない", () => {
    const s = getTimeStatus({ startedAt: start, limitMinutes: 30, policy: "hard", now: at(10) });
    expect(s).toMatchObject({ hasLimit: true, isOver: false, blocksInput: false });
    expect(s.remainingMs).toBe(20 * 60 * 1000);
  });

  it("超過後: soft は続けられる(超過時間を返す)、hard は入力を止める", () => {
    const soft = getTimeStatus({ startedAt: start, limitMinutes: 30, policy: "soft", now: at(33) });
    expect(soft).toMatchObject({ isOver: true, blocksInput: false, remainingMs: 0 });
    expect(soft.overtimeMs).toBe(3 * 60 * 1000);

    expect(getTimeStatus({ startedAt: start, limitMinutes: 30, policy: "hard", now: at(33) }).blocksInput).toBe(true);
  });

  it("ちょうど制限時間になった瞬間から、超過として扱う", () => {
    expect(getTimeStatus({ startedAt: start, limitMinutes: 30, policy: "hard", now: at(30) }).isOver).toBe(true);
  });

  it("未知のpolicyは、止めない側(soft)に倒す", () => {
    expect(getTimeStatus({ startedAt: start, limitMinutes: 5, policy: "weird", now: at(99) }).blocksInput).toBe(false);
  });
});

describe("statusFromElapsed(画面の時計が使う)", () => {
  it("経過時間から、残り・超過を求める。getTimeStatusと同じ結果になる", () => {
    expect(statusFromElapsed(10 * 60 * 1000, 30, "hard")).toMatchObject({ isOver: false, remainingMs: 20 * 60 * 1000 });
    expect(statusFromElapsed(31 * 60 * 1000, 30, "hard")).toMatchObject({ isOver: true, blocksInput: true, overtimeMs: 60 * 1000 });
    expect(statusFromElapsed(5, null, "hard").hasLimit).toBe(false);
  });
});

describe("formatClock", () => {
  it("分:秒で表示する(秒は0埋め)", () => {
    expect(formatClock(125_000)).toBe("2:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("shouldJudgeDiscussionState", () => {
  const base = { suggestAfterTurn: 4, aiCloseSuggestionEnabled: true, alreadySuggested: false, ended: false };

  it("発言が少ないうちは判定しない(費用を抑える)", () => {
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 3 })).toBe(false);
  });

  it("4発言目から、2発言おきに判定する", () => {
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 4 })).toBe(true);
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 5 })).toBe(false);
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 6 })).toBe(true);
  });

  it("「もう少し続ける」の後は、指定の発言数に達するまで判定しない", () => {
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 6, suggestAfterTurn: 9 })).toBe(false);
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 9, suggestAfterTurn: 9 })).toBe(true);
  });

  it("無効・提案済み・終了済みなら判定しない", () => {
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 4, aiCloseSuggestionEnabled: false })).toBe(false);
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 4, alreadySuggested: true })).toBe(false);
    expect(shouldJudgeDiscussionState({ ...base, studentTurnCount: 4, ended: true })).toBe(false);
  });
});
