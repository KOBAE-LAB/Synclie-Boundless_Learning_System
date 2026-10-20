import { describe, expect, it } from "vitest";
import { formatGuidanceInput, mapIndividuals, restoreNames, studentLabel } from "./input";
import type { StudentStat } from "./stats";

const stat = (studentId: string, over: Partial<StudentStat> = {}): StudentStat => ({
  studentId,
  turnCount: 5,
  submissionCount: 1,
  lastActivityAt: null,
  evaluationCount: 2,
  avgScore: 2,
  axisAvg: { logic: 2, evidence: 1.5, rebuttal: 2.5 },
  strengths: null,
  challenges: "根拠が弱い",
  ...over,
});

describe("formatGuidanceInput", () => {
  const { text, labelToStudentId } = formatGuidanceInput({
    course: { title: "理科", objective: "光合成", discussionStyle: null, learnerLevel: null },
    students: [
      { stat: stat("uuid-aaa"), confusions: ["どこまで書くか迷った"] },
      { stat: stat("uuid-bbb"), confusions: [] },
    ],
    personas: [{ name: "ミナ", total: 4, unwarranted: 1 }],
    discussionNextQuestions: ["暗所ではどうなる?"],
  });
  it("学習者のidや氏名をAIへの入力に含めず、仮の呼び名にする", () => {
    expect(text).not.toContain("uuid-aaa");
    expect(text).toContain("学習者A");
    expect(text).toContain("学習者B");
  });
  it("仮の呼び名から本人のidに戻せる", () => {
    expect(labelToStudentId.get("学習者A")).toBe("uuid-aaa");
    expect(labelToStudentId.get("学習者B")).toBe("uuid-bbb");
  });
  it("観点別の平均・迷ったこと・議論の問いを含む", () => {
    expect(text).toContain("根拠の質1.5");
    expect(text).toContain("どこまで書くか迷った");
    expect(text).toContain("暗所ではどうなる?");
  });
});

describe("mapIndividuals", () => {
  const map = new Map([["学習者A", "u1"], ["学習者B", "u2"]]);
  it("知らない呼び名と重複は捨てる", () => {
    const out = mapIndividuals(
      [
        { label: "学習者A", observation: "o", suggestedAction: "a" },
        { label: "学習者Z", observation: "o", suggestedAction: "a" },
        { label: "学習者A", observation: "o2", suggestedAction: "a2" },
      ],
      map,
    );
    expect(out).toEqual([{ studentId: "u1", observation: "o", suggestedAction: "a" }]);
  });
});

describe("studentLabel", () => {
  it("A〜Zのあとは数字", () => {
    expect(studentLabel(0)).toBe("学習者A");
    expect(studentLabel(25)).toBe("学習者Z");
    expect(studentLabel(26)).toBe("学習者27");
  });
});

describe("restoreNames", () => {
  it("仮の呼び名を実名に戻す(学習者1と学習者10を取り違えない)", () => {
    const names = new Map([["学習者1", "山田さん"], ["学習者10", "佐藤さん"]]);
    expect(restoreNames("学習者10と学習者1に声かけ", names)).toBe("佐藤さんと山田さんに声かけ");
  });
});
