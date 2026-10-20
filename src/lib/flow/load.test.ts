import { describe, expect, it } from "vitest";
import { assertDiscussionAllowed, stepContextFor, loadLearnerFlow } from "./load";

function fakeAdmin(opts: { steps: Record<string, unknown>[]; doneStepIds: string[]; stepsInOrder?: boolean }) {
  return {
    from(table: string) {
      if (table === "course_steps") {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: opts.steps }) }) }) };
      }
      if (table === "courses") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { steps_in_order: opts.stepsInOrder ?? true } }) }) }) };
      }
      if (table === "step_progress") {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: opts.doneStepIds.map((step_id) => ({ step_id })) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const step = (id: string, position: number, kind: "input" | "output", title: string, extra: Record<string, unknown> = {}) => ({
  id, course_id: "c1", position, kind, title, instruction: "", material_id: null, video_url: null, minutes: null, check_questions: null, ...extra,
});

describe("assertDiscussionAllowed(サーバー側の議論の入口の関門)", () => {
  const steps = [step("i1", 1, "input", "動画を見る"), step("o1", 2, "output", "議論する", { instruction: "根拠を示そう" })];

  it("インプットが未了なら、理由つきで議論を止める", async () => {
    await expect(assertDiscussionAllowed(fakeAdmin({ steps, doneStepIds: [] }), "c1", "s1")).rejects.toThrow("動画を見る");
  });
  it("インプットを終えれば入れる", async () => {
    await expect(assertDiscussionAllowed(fakeAdmin({ steps, doneStepIds: ["i1"] }), "c1", "s1")).resolves.toBeTruthy();
  });
  it("ステップが無い授業は、これまでどおり入れる", async () => {
    await expect(assertDiscussionAllowed(fakeAdmin({ steps: [], doneStepIds: [] }), "c1", "s1")).resolves.toBeTruthy();
  });
  it("順番を強制しない授業は、インプット未了でも入れる", async () => {
    await expect(assertDiscussionAllowed(fakeAdmin({ steps, doneStepIds: [], stepsInOrder: false }), "c1", "s1")).resolves.toBeTruthy();
  });
});

describe("stepContextFor", () => {
  it("アウトプットの間だけ、ステップの指示をAIの文脈に添える", async () => {
    const steps = [step("i1", 1, "input", "動画を見る"), step("o1", 2, "output", "議論する", { instruction: "根拠を示そう" })];
    const inputPhase = await loadLearnerFlow(fakeAdmin({ steps, doneStepIds: [] }), "c1", "s1");
    expect(stepContextFor(inputPhase)).toBeUndefined();
    const outputPhase = await loadLearnerFlow(fakeAdmin({ steps, doneStepIds: ["i1"] }), "c1", "s1");
    expect(stepContextFor(outputPhase)).toContain("根拠を示そう");
  });
});
