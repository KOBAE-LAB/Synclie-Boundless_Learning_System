import { describe, expect, it } from "vitest";
import { maskNames } from "./anonymize";
import { MAX_EPISODES_PER_SESSION, MAX_NARRATIVE_CHARS, normalizeExtractedEpisodes, type ExtractedEpisode } from "@/lib/ai/episode-extraction";

const episode = (startTurn: number, endTurn: number, narrative = "自分は迷った。"): ExtractedEpisode => ({
  type: "stuck",
  startTurn,
  endTurn,
  contextHeader: "見出し",
  narrative,
});

describe("maskNames(匿名化の機械的な確認)", () => {
  it("フルネームと、姓・名それぞれを伏せる(長い方から)", () => {
    expect(maskNames("山田太郎さんと山田さんと太郎くん", ["山田 太郎"])).toBe("〇〇さんと〇〇さんと〇〇くん");
  });
  it("組織名も伏せる。1文字の名前は対象にしない", () => {
    expect(maskNames("長崎県立〇〇高校の林です", ["長崎県立〇〇高校", "林"])).toBe("〇〇の林です");
  });
});

describe("normalizeExtractedEpisodes", () => {
  it("発言の範囲を記録の範囲に収め、逆順なら入れ替える", () => {
    expect(normalizeExtractedEpisodes([episode(9, 2)], 5, [])).toEqual([expect.objectContaining({ startTurn: 2, endTurn: 5 })]);
  });
  it("すでにエピソードにした範囲や、互いに重なる場面は捨てる", () => {
    const result = normalizeExtractedEpisodes([episode(1, 3), episode(3, 4), episode(6, 7)], 10, [{ startTurn: 6, endTurn: 8 }]);
    expect(result.map((e) => [e.startTurn, e.endTurn])).toEqual([[1, 3]]);
  });
  it(`最大${MAX_EPISODES_PER_SESSION}件、語りは${MAX_NARRATIVE_CHARS}字まで`, () => {
    const long = "あ".repeat(MAX_NARRATIVE_CHARS + 50);
    const result = normalizeExtractedEpisodes([episode(1, 1, long), episode(2, 2), episode(3, 3), episode(4, 4)], 10, []);
    expect(result).toHaveLength(MAX_EPISODES_PER_SESSION);
    expect(result[0].narrative.length).toBe(MAX_NARRATIVE_CHARS);
  });
  it("語りが空の場面は捨てる", () => {
    expect(normalizeExtractedEpisodes([episode(1, 2, "  ")], 5, [])).toEqual([]);
  });
});
