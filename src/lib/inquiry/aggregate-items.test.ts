import { describe, expect, it } from "vitest";
import {
  aggregateDisplayName,
  buildAggregateMemoryText,
  itemsForLesson,
  itemsToLines,
  linesToItems,
  parseAggregateItems,
  type AggregateItem,
} from "./aggregate-items";

const items: AggregateItem[] = [
  { kind: "stumble", text: "多くの人が、条件を絞る前に案を決めようとした", lessonNo: 2 },
  { kind: "misconception", text: "多くの人が、平均だけで比べてよいと考えた", lessonNo: 5 },
  { kind: "good_question", text: "「それは誰にとっての問題か」と聞くと動いた", lessonNo: null },
];

describe("集約型の項目", () => {
  it("名前: 年度+みんな+呼び名+(AI)", () => {
    expect(aggregateDisplayName(2025, "ミライ")).toBe("2025年度のみんな ミライ(AI)");
    expect(aggregateDisplayName(2025, "")).toBe("2025年度のみんな(AI)");
    expect(aggregateDisplayName(null, "")).toBe("前の年度のみんな(AI)");
  });
  it("壊れた形の項目は捨てる・上限を超えない", () => {
    expect(parseAggregateItems(null)).toEqual([]);
    expect(parseAggregateItems({ items: [{ kind: "x", text: "a" }, { kind: "stumble", text: "  " }, { kind: "stumble", text: "ok", lessonNo: 0 }] })).toEqual([
      { kind: "stumble", text: "ok", lessonNo: null },
    ]);
    expect(parseAggregateItems({ items: Array.from({ length: 20 }, () => ({ kind: "stumble", text: "a" })) })).toHaveLength(8);
  });
  it("編集用の文字と、項目が行き来できる(授業回つき・なし)", () => {
    const lines = itemsToLines(items);
    expect(lines.split("\n")[0]).toBe("つまずき(第2回): 多くの人が、条件を絞る前に案を決めようとした");
    expect(lines.split("\n")[2]).toBe("有効だった問い: 「それは誰にとっての問題か」と聞くと動いた");
    expect(linesToItems(lines)).toEqual(items);
  });
  it("読めない行・知らない種類は捨てる。全角のコロン・括弧も読める", () => {
    expect(linesToItems("メモ: 何か\nただの文\nつまずき(第3回)：全角のコロン\nよくある誤解（第4回）: 全角の括弧")).toEqual([
      { kind: "stumble", text: "全角のコロン", lessonNo: 3 },
      { kind: "misconception", text: "全角の括弧", lessonNo: 4 },
    ]);
  });
  it("授業回で絞る: いまの回までと、授業回が無い項目だけ。回が分からなければ絞らない", () => {
    expect(itemsForLesson(items, 3).map((i) => i.lessonNo)).toEqual([2, null]);
    expect(itemsForLesson(items, 5)).toHaveLength(3);
    expect(itemsForLesson(items, null)).toHaveLength(3);
  });
  it("記憶の文: 種類ごとに並べ、ルールを付ける。項目が無いときも話せる文になる", () => {
    const text = buildAggregateMemoryText(items);
    expect(text).toContain("## つまずき");
    expect(text).toContain("(第5回の頃)");
    expect(text).toContain("特定の誰かではなく");
    expect(buildAggregateMemoryText([])).toContain("まだ少ない");
  });
});
