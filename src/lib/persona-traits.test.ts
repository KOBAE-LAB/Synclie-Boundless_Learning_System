import { describe, expect, it } from "vitest";
import { computePacing, normalizeReplyTempo, normalizeThinkingDepth, TEMPO_PARAMS } from "./persona-traits";

describe("normalize", () => {
  it("未設定・不正な値は、標準・ふつう(既存のペルソナは今までどおり動く)", () => {
    expect(normalizeThinkingDepth(undefined)).toBe("標準");
    expect(normalizeThinkingDepth("天才")).toBe("標準");
    expect(normalizeThinkingDepth("じっくり論理的")).toBe("じっくり論理的");
    expect(normalizeReplyTempo(undefined)).toBe("ふつう");
    expect(normalizeReplyTempo("ゆっくり")).toBe("ゆっくり");
  });
});

describe("computePacing", () => {
  const text = "あ".repeat(60);

  it("すばやい: 届いた分を、すぐ全部出す", () => {
    const s = computePacing([{ text, tempo: "すばやい" }], 0);
    expect(s.shown).toEqual([60]);
    expect(s.typingIndex).toBeNull();
    expect(s.finished).toBe(true);
  });

  it("ふつう: 最初は『入力中…』の間があり、そのあと一定の速さで文字が出る", () => {
    const { preDelayMs, charsPerSec } = TEMPO_PARAMS["ふつう"];
    expect(computePacing([{ text, tempo: "ふつう" }], preDelayMs - 1)).toMatchObject({ shown: [0], typingIndex: 0, finished: false });
    const half = computePacing([{ text, tempo: "ふつう" }], preDelayMs + 250);
    expect(half.shown[0]).toBe(Math.floor(0.25 * charsPerSec));
    expect(half.typingIndex).toBeNull();
    expect(computePacing([{ text, tempo: "ふつう" }], preDelayMs + 5000).finished).toBe(true);
  });

  it("ゆっくりは、すばやいより長くかかる", () => {
    const at = (tempo: "すばやい" | "ふつう" | "ゆっくり", ms: number) => computePacing([{ text, tempo }], ms).finished;
    expect(at("すばやい", 0)).toBe(true);
    expect(at("ふつう", 2000)).toBe(true);
    expect(at("ゆっくり", 2000)).toBe(false);
    expect(at("ゆっくり", 3600)).toBe(true);
  });

  it("複数のメッセージは順番に出す(前の人が出し終えてから、次の人の『入力中…』が始まる)", () => {
    const msgs = [
      { text, tempo: "すばやい" as const },
      { text, tempo: "ゆっくり" as const },
    ];
    const early = computePacing(msgs, 100);
    expect(early.shown).toEqual([60, 0]);
    expect(early.typingIndex).toBe(1);
    expect(computePacing(msgs, TEMPO_PARAMS["ゆっくり"].preDelayMs + 1000).shown[1]).toBe(30);
    expect(computePacing(msgs, 10000).finished).toBe(true);
  });

  it("メッセージが無ければ、出し終えた扱い", () => {
    expect(computePacing([], 0)).toEqual({ shown: [], typingIndex: null, finished: true });
  });
});
