import { describe, expect, it } from "vitest";
import { assignPersonaTones, toneClass, TONE_COUNT } from "./persona-tones";

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
