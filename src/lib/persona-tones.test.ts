import { describe, expect, it } from "vitest";
import { assignPersonaTones, personaInitial, toneClass, TONE_COUNT } from "./persona-tones";

describe("assignPersonaTones", () => {
  it("作成順に、0から順に色を割り当てる(同じ並びなら、いつも同じ結果)", () => {
    expect(assignPersonaTones(["a", "b", "c"])).toEqual({ a: 0, b: 1, c: 2 });
    expect(assignPersonaTones(["a", "b", "c"])).toEqual(assignPersonaTones(["a", "b", "c"]));
  });

  it("色の数を超えたら、先頭に戻る", () => {
    const ids = Array.from({ length: TONE_COUNT + 2 }, (_, i) => `p${i}`);
    const tones = assignPersonaTones(ids);
    expect(tones[`p${TONE_COUNT}`]).toBe(0);
    expect(tones[`p${TONE_COUNT + 1}`]).toBe(1);
  });
});

describe("toneClass", () => {
  it("色の番号に対応するクラス名。不明なら中立", () => {
    expect(toneClass(0)).toBe("tone-0");
    expect(toneClass(5)).toBe("tone-5");
    expect(toneClass(undefined)).toBe("tone-neutral");
    expect(toneClass(7)).toBe("tone-1");
    expect(toneClass(-1)).toBe("tone-5");
  });
});

describe("personaInitial(アバターが無いときの頭文字)", () => {
  it("先輩型は、年度の数字ではなく呼び名の頭文字", () => {
    expect(personaInitial("2025年度の先輩 ミナト(AI)")).toBe("ミ");
    expect(personaInitial("先輩 ソラ(AI)")).toBe("ソ");
    expect(personaInitial("2025年度の先輩 ミナト（AI）")).toBe("ミ");
    expect(personaInitial("2025年度のみんな ミライ(AI)")).toBe("ミ");
    expect(personaInitial("2025年度のみんな(AI)")).toBe("み");
    expect(personaInitial("前の年度のみんな(AI)")).toBe("み");
  });
  it("ふつうのペルソナは、名前の先頭の文字", () => {
    expect(personaInitial("島の漁師")).toBe("島");
    expect(personaInitial("")).toBe("");
  });
});
