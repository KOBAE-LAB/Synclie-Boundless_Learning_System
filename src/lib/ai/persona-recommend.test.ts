import { describe, expect, it } from "vitest";
import { buildRecommendationPrompt, cleanPersonaName } from "./persona-recommend";

describe("cleanPersonaName", () => {
  it("『〜派の』のような説明的な接頭辞は取り除く(名前は呼び名だけにする)", () => {
    expect(cleanPersonaName("慎重派の山田くん")).toBe("山田くん");
    expect(cleanPersonaName("エビデンス重視派の田中さん")).toBe("田中さん");
  });
  it("普通の名前はそのまま、前後の空白・かっこは除く", () => {
    expect(cleanPersonaName("  ミライさん ")).toBe("ミライさん");
    expect(cleanPersonaName("『コウタくん』")).toBe("コウタくん");
  });
  it("名前の途中の『派』には触れない", () => {
    expect(cleanPersonaName("派手好きのミライさん")).toBe("派手好きのミライさん");
  });
});

describe("buildRecommendationPrompt", () => {
  const base = { course: { title: "光合成" }, materialText: "", count: 3, existing: [] };

  it("人数・授業名を含み、資料が無い場合も破綻しない", () => {
    const prompt = buildRecommendationPrompt(base);
    expect(prompt).toContain("3人分");
    expect(prompt).toContain("授業名: 光合成");
    expect(prompt).toContain("資料はまだ登録されていない");
  });

  it("討論の型に応じた指針と、ねらい・校種学年を含む", () => {
    const prompt = buildRecommendationPrompt({
      ...base,
      course: { title: "光合成", objective: "光の強さと速さの関係", learner_level: "中学校", discussion_style: "opposing" },
    });
    expect(prompt).toContain("光の強さと速さの関係");
    expect(prompt).toContain("中学校");
    expect(prompt).toContain("対立する立場");
  });

  it("既存のメンバーと教師のヒントを、重複回避・反映の手がかりとして渡す", () => {
    const prompt = buildRecommendationPrompt({
      ...base,
      existing: [{ name: "コウタくん", role: "クラスメイト", position: "光があれば夜でもできる" }],
      hint: "反対意見の中学生",
    });
    expect(prompt).toContain("コウタくん");
    expect(prompt).toContain("反対意見の中学生");
  });

  it("名前に『〜派の』を付けない指示を含む(利用者の明示の要望)", () => {
    expect(buildRecommendationPrompt(base)).toContain("『〜派の』のような説明的な接頭辞は付けない");
  });

  it("提案作業の事情(資料が未登録など)を、ペルソナの設定に書かせない指示を含む", () => {
    expect(buildRecommendationPrompt(base)).toContain("この提案作業の事情を書かない");
  });

  it("資料が長くても、上限で切って渡す", () => {
    const prompt = buildRecommendationPrompt({ ...base, materialText: "あ".repeat(50000) });
    expect(prompt.length).toBeLessThan(10000);
  });
});
