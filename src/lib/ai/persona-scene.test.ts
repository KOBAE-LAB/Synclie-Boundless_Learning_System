import { describe, expect, it } from "vitest";
import { buildSceneSystemPrompt, maxMessagesFor, normalizeSceneMessages, type ScenePersona } from "./persona-scene";

const kouta: ScenePersona = { id: "p1", name: "コウタくん", role: "クラスメイト", tone: "くだけた口調", position: "光があれば夜でもできる", goal: "根拠を問う", speakingFrequency: "積極的", teachingDegree: "問い返すのみ", interventionCondition: "" };
const nana: ScenePersona = { id: "p2", name: "ナナさん", role: "慎重な先輩", tone: "丁寧", position: "データから言える範囲だけ", goal: "条件を確かめさせる", speakingFrequency: "控えめ", teachingDegree: "ヒントを出す", interventionCondition: "根拠なく結論を出したとき" };
const base = { personas: [kouta, nana], materialText: "資料", maxMessages: 3, calledOut: [] as string[] };

describe("maxMessagesFor", () => {
  it("活発さに応じた上限。不明な値は『普通』", () => {
    expect(maxMessagesFor("quiet")).toBe(2);
    expect(maxMessagesFor("normal")).toBe(3);
    expect(maxMessagesFor("lively")).toBe(4);
    expect(maxMessagesFor(undefined)).toBe(3);
    expect(maxMessagesFor("weird")).toBe(3);
  });
});

describe("buildSceneSystemPrompt", () => {
  it("全員の設定(性格・立場・発言頻度・介入の条件)を渡す", () => {
    const prompt = buildSceneSystemPrompt(base);
    for (const word of ["コウタくん", "ナナさん", "光があれば夜でもできる", "根拠なく結論を出したとき", "控えめ", "積極的"]) {
      expect(prompt).toContain(word);
    }
  });

  it("視点から自然に口を出す・黙ってよい・AI同士の議論も可・最後は学習者に戻す、を指示する", () => {
    const prompt = buildSceneSystemPrompt(base);
    expect(prompt).toContain("口を出すのが自然な人");
    expect(prompt).toContain("黙っていてよい");
    expect(prompt).toContain("名前を呼んで直接答える");
    expect(prompt).toContain("学習者に話を返す");
    expect(prompt).toContain("最大3発言");
  });

  it("名指しされたメンバーは必ず最初に答える", () => {
    expect(buildSceneSystemPrompt({ ...base, calledOut: ["ナナさん"] })).toContain("ナナさん は、必ず最初に答える");
  });

  it("F20の原則: 根拠なく同調しない(学習者にも他のメンバーにも)・譲歩の自己申告(conceded)を求める", () => {
    const prompt = buildSceneSystemPrompt(base);
    expect(prompt).toContain("根拠なく同調しない");
    expect(prompt).toContain("conceded");
  });

  it("既に出た内容を言い換えて繰り返さず、新しい観点を加える指示を含む", () => {
    expect(buildSceneSystemPrompt(base)).toContain("言い換えて繰り返さない");
  });

  it("AIであることの明示を、毎回繰り返さない", () => {
    expect(buildSceneSystemPrompt(base)).toContain("繰り返さない");
  });

  it("沈黙時の継続は、学習者への問いかけで終える指示になる。授業の文脈も入れられる", () => {
    const prompt = buildSceneSystemPrompt({ ...base, silence: true, courseContext: "- 授業のねらい・議題: 光合成" });
    expect(prompt).toContain("学習者は少し黙っています");
    expect(prompt).toContain("言い換えて繰り返してはいけません");
    expect(prompt).toContain("直前に話したメンバー以外から話し始め");
    expect(prompt).toContain("授業のねらい・議題: 光合成");
  });
});

describe("normalizeSceneMessages", () => {
  const raw = (speaker: string, reply = "こんにちは", conceded = false) => ({ speaker, reply, conceded });

  it("話者名をメンバーに対応づける(完全一致、無ければ末尾一致)", () => {
    const messages = normalizeSceneMessages([raw("コウタくん"), raw("ナナさん")], [kouta, nana], 3, kouta);
    expect(messages.map((m) => m.personaId)).toEqual(["p1", "p2"]);
  });

  it("未知の話者・空の発言は捨て、上限で切る", () => {
    const messages = normalizeSceneMessages(
      [raw("だれか"), raw("コウタくん", "  "), raw("コウタくん", "A"), raw("ナナさん", "B"), raw("コウタくん", "C"), raw("ナナさん", "D")],
      [kouta, nana],
      3,
      kouta,
    );
    expect(messages.map((m) => m.reply)).toEqual(["A", "B", "C"]);
  });

  it("譲歩の自己申告(conceded)は、発言したメンバーごとに保たれる", () => {
    const messages = normalizeSceneMessages([raw("コウタくん", "A", true), raw("ナナさん", "B", false)], [kouta, nana], 3, kouta);
    expect(messages.map((m) => [m.personaId, m.conceded])).toEqual([["p1", true], ["p2", false]]);
  });

  it("話者を全く対応づけられなくても、最低1発言は返す(本文があれば、代わりのメンバーが話す)", () => {
    const messages = normalizeSceneMessages([raw("だれか", "こんにちは")], [kouta, nana], 3, nana);
    expect(messages).toEqual([{ personaId: "p2", name: "ナナさん", reply: "こんにちは", conceded: false }]);
  });

  it("本文がすべて空なら、空のまま返す(呼び出し側がエラーにする)", () => {
    expect(normalizeSceneMessages([raw("コウタくん", " ")], [kouta, nana], 3, kouta)).toEqual([]);
  });
});
