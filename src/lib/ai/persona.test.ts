import { describe, expect, it } from "vitest";
import { buildPersonaSystemPrompt, COMMON_GUARDRAILS, type PersonaProfile } from "./persona";
import { buildCourseContext } from "@/lib/courses/settings";

const base: PersonaProfile = {
  name: "ユウ",
  role: "クラスメイト",
  tone: "友達言葉",
  stance: "立場: ...\n目標: ...",
  materialText: "[資料1]\n光合成の資料",
};

describe("buildPersonaSystemPrompt: 授業の文脈", () => {
  it("授業設定があれば『この授業について』として、ねらい・校種学年・討論の型を入れる", () => {
    const courseContext = buildCourseContext({
      title: "光合成",
      objective: "光の強さと速さの関係を説明しあう",
      learner_level: "中学校",
      discussion_style: "opposing",
    });
    const prompt = buildPersonaSystemPrompt({ ...base, courseContext });
    expect(prompt).toContain("# この授業について");
    expect(prompt).toContain("光の強さと速さの関係を説明しあう");
    expect(prompt).toContain("中学校");
    expect(prompt).toContain("対立型");
  });

  it("設定が無ければ、従来どおり『この授業について』の節を出さない", () => {
    expect(buildPersonaSystemPrompt(base)).not.toContain("# この授業について");
  });

  it("協調型でも、共通ガードレール(根拠なく同調しない)は常に付く", () => {
    const courseContext = buildCourseContext({ discussion_style: "collaborative" });
    const prompt = buildPersonaSystemPrompt({ ...base, courseContext });
    expect(prompt).toContain(COMMON_GUARDRAILS.trim().split("\n")[0]);
    expect(prompt).toContain("安易に同調しない");
  });
});
