import { describe, expect, it } from "vitest";
import { buildCourseContext, parseCourseSettingsInput, reasoningEffortFor } from "./settings";

describe("parseCourseSettingsInput", () => {
  const base = { objective: "", learnerLevel: "", discussionStyle: "", aiMemberCount: "" };

  it("空欄はすべてnull(設定なし)", () => {
    expect(parseCourseSettingsInput(base)).toMatchObject({
      objective: null,
      learner_level: null,
      discussion_style: null,
      ai_member_count: null,
    });
  });

  it("正しい値はそのまま保存できる形にする", () => {
    expect(
      parseCourseSettingsInput({
        objective: "  水の循環を説明しあう  ",
        learnerLevel: "中学校",
        discussionStyle: "opposing",
        aiMemberCount: "3",
      }),
    ).toMatchObject({
      objective: "水の循環を説明しあう",
      learner_level: "中学校",
      discussion_style: "opposing",
      ai_member_count: 3,
    });
  });

  it("不正な値(未知の校種・型、範囲外や非数の人数)は、保存せずnullにする", () => {
    const parsed = parseCourseSettingsInput({
      objective: "",
      learnerLevel: "宇宙人",
      discussionStyle: "random",
      aiMemberCount: "99",
    });
    expect(parsed).toMatchObject({ learner_level: null, discussion_style: null, ai_member_count: null });
    expect(parseCourseSettingsInput({ ...base, aiMemberCount: "abc" }).ai_member_count).toBeNull();
    expect(parseCourseSettingsInput({ ...base, aiMemberCount: "0" }).ai_member_count).toBeNull();
  });

  it("議論の終わりの設定: 既定は、制限なし・超過しても続けられる・評価に影響しない・AIが提案する", () => {
    expect(parseCourseSettingsInput(base)).toMatchObject({
      time_limit_minutes: null,
      time_limit_policy: "soft",
      time_limit_affects_evaluation: false,
      ai_close_suggestion: true,
    });
  });

  it("制限時間は、用意した選択肢の値だけを保存する(不正な値は制限なしにする)", () => {
    const parse = (timeLimitMinutes: string) => parseCourseSettingsInput({ ...base, timeLimitMinutes }).time_limit_minutes;
    expect(parse("30")).toBe(30);
    expect(parse("7")).toBeNull();
    expect(parse("-5")).toBeNull();
    expect(parse("abc")).toBeNull();
  });

  it("超過の扱いはhardだけを受け付け、評価への影響は制限時間がある時だけ有効にする", () => {
    expect(parseCourseSettingsInput({ ...base, timeLimitMinutes: "20", timeLimitPolicy: "hard" }).time_limit_policy).toBe("hard");
    expect(parseCourseSettingsInput({ ...base, timeLimitMinutes: "20", timeLimitPolicy: "x" }).time_limit_policy).toBe("soft");
    expect(
      parseCourseSettingsInput({ ...base, timeLimitMinutes: "20", timeLimitAffectsEvaluation: true })
        .time_limit_affects_evaluation,
    ).toBe(true);
    expect(
      parseCourseSettingsInput({ ...base, timeLimitMinutes: "", timeLimitAffectsEvaluation: true })
        .time_limit_affects_evaluation,
    ).toBe(false);
  });

  it("発言の活発さは、quiet/livelyだけを受け付け、それ以外は普通", () => {
    const parse = (v?: string) => parseCourseSettingsInput({ ...base, discussionLiveliness: v }).discussion_liveliness;
    expect(parse("quiet")).toBe("quiet");
    expect(parse("lively")).toBe("lively");
    expect(parse("normal")).toBe("normal");
    expect(parse("wild")).toBe("normal");
    expect(parse()).toBe("normal");
  });

  it("推論の深さ: fast/deepだけを受け付け、それ以外は標準。OpenAIの指定は標準なら出さない", () => {
    const parse = (v?: string) => parseCourseSettingsInput({ ...base, reasoningDepth: v }).reasoning_depth;
    expect(parse("fast")).toBe("fast");
    expect(parse("deep")).toBe("deep");
    expect(parse("standard")).toBe("standard");
    expect(parse("max")).toBe("standard");
    expect(parse()).toBe("standard");
    expect(reasoningEffortFor("fast")).toBe("low");
    expect(reasoningEffortFor("deep")).toBe("high");
    expect(reasoningEffortFor("standard")).toBeUndefined();
    expect(reasoningEffortFor(null)).toBeUndefined();
  });

  it("AIによるまとめの提案は、明示的にオフにした時だけオフ", () => {
    expect(parseCourseSettingsInput({ ...base, aiCloseSuggestion: false }).ai_close_suggestion).toBe(false);
  });

  it("ねらいが極端に長くても、上限で切る", () => {
    expect(parseCourseSettingsInput({ ...base, objective: "あ".repeat(5000) }).objective).toHaveLength(1000);
  });
});

describe("buildCourseContext", () => {
  it("設定が何も無ければundefined(従来どおり、授業の文脈は付けない)", () => {
    expect(buildCourseContext({})).toBeUndefined();
    expect(buildCourseContext({ objective: null, learner_level: null, discussion_style: null })).toBeUndefined();
  });

  it("入力された項目だけを文脈にする", () => {
    const text = buildCourseContext({ title: "光合成", objective: "光の強さと速さの関係", learner_level: "中学校" });
    expect(text).toContain("授業名: 光合成");
    expect(text).toContain("光の強さと速さの関係");
    expect(text).toContain("中学校");
    expect(text).not.toContain("討論の型");
  });

  it("討論の型の指示を含む。協調型でも『安易に同調しない』を残す", () => {
    expect(buildCourseContext({ discussion_style: "opposing" })).toContain("対立型");
    expect(buildCourseContext({ discussion_style: "collaborative" })).toContain("安易に同調してはいけません");
    expect(buildCourseContext({ discussion_style: "teaching" })).toContain("分かっていない仲間");
  });
});
