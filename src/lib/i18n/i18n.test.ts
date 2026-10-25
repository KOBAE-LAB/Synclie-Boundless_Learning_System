import { describe, expect, it } from "vitest";
import { ja } from "./dictionaries/ja";
import { en } from "./dictionaries/en";
import { isLang, langFromAcceptLanguage } from "./config";
import { interpolate, translatorFor } from "./translate";

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("辞書(日本語と英語)", () => {
  const J = flatten(ja);
  const E = flatten(en);
  it("英語は、日本語と同じキーをすべて持つ", () => {
    expect(Object.keys(E).sort()).toEqual(Object.keys(J).sort());
  });
  it("どの文言も空ではない", () => {
    for (const [k, v] of Object.entries({ ...J })) expect(v.trim(), `ja:${k}`).not.toBe("");
    for (const [k, v] of Object.entries({ ...E })) expect(v.trim(), `en:${k}`).not.toBe("");
  });
  it("差し込み({name} など)は、日本語と英語で同じ", () => {
    for (const k of Object.keys(J)) expect(placeholders(E[k]), k).toEqual(placeholders(J[k]));
  });
  it("英語の文言に、日本語の文字が混ざっていない(固有の名前を除く)", () => {
    const allowed = new Set(["login.guide"]); // (なし)
    for (const [k, v] of Object.entries(E)) {
      if (allowed.has(k)) continue;
      const stripped = v.replace(/日本語|「Mei」|Open JTalk/g, "");
      expect(/[ぁ-んァ-ヶ一-龠]/.test(stripped), `en:${k} -> ${v}`).toBe(false);
    }
  });
});

describe("translatorFor", () => {
  it("言語ごとの文言を返し、差し込みを置き換える", () => {
    expect(translatorFor("ja")("series.lessonsTotal", { title: "理科", n: 8 })).toBe("理科(全8回)");
    expect(translatorFor("en")("series.lessonsTotal", { title: "Science", n: 8 })).toBe("Science (8 lessons)");
  });
  it("差し込みの値が無ければ、{name} をそのまま残す", () => {
    expect(interpolate("Hi {name}")).toBe("Hi {name}");
    expect(interpolate("Hi {name}", { other: 1 })).toBe("Hi {name}");
  });
});

describe("言語の決め方", () => {
  it("isLang は、日本語と英語だけを認める", () => {
    expect(isLang("ja")).toBe(true);
    expect(isLang("en")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
  it("ブラウザの優先言語の先頭が英語なら英語、それ以外は日本語", () => {
    expect(langFromAcceptLanguage("en-US,en;q=0.9,ja;q=0.8")).toBe("en");
    expect(langFromAcceptLanguage("en")).toBe("en");
    expect(langFromAcceptLanguage("ja,en;q=0.8")).toBe("ja");
    expect(langFromAcceptLanguage("fr-FR,fr;q=0.9")).toBe("ja");
    expect(langFromAcceptLanguage(null)).toBe("ja");
    expect(langFromAcceptLanguage("")).toBe("ja");
  });
});
