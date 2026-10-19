import { describe, expect, it } from "vitest";
import { buildCourseContext, parseCourseSettingsInput } from "./settings";

describe("parseCourseSettingsInput", () => {
  const base = { objective: "", learnerLevel: "", discussionStyle: "", aiMemberCount: "" };

  it("空欄はすべてnull(設定なし)", () => {
    expect(parseCourseSettingsInput(base)).toEqual({
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
    ).toEqual({
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
