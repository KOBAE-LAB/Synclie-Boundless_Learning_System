import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "./fake-admin";

const draftSeniorPersona = vi.fn();
vi.mock("@/lib/ai/senior-persona-draft", () => ({ draftSeniorPersona: (...args: unknown[]) => draftSeniorPersona(...args) }));
vi.mock("@/lib/ai/openai", () => ({ MODEL_JUDGE: "m", MODEL_EMBEDDING: "e", openai: {} }));
const hasConsent = vi.fn();
vi.mock("@/lib/consent", () => ({ hasConsent: (...args: unknown[]) => hasConsent(...args) }));
vi.mock("next/server", () => ({ after: () => undefined }));
const embedQuery = vi.fn();
vi.mock("@/lib/rag/search", () => ({
  embedQuery: (...args: unknown[]) => embedQuery(...args),
  searchMaterialChunks: async () => ["教材5件"],
  searchMaterialChunksByEmbedding: async (_c: string, _e: number[], n: number) => [`教材${n}件`],
}));

import { addLoan, canUseArchived, createSeniorDraft, seniorDisplayName, SeniorRuleError, updateSeniorPersona, MAX_LOANS_PER_LESSON } from "./senior";
import { buildSeniorMemory, pickRetrospectiveTrajectory, pickThenTrajectory } from "./senior-memory";
import { loadActiveMembers, retrieveForTurn } from "@/lib/learn/members";

type Admin = Parameters<typeof addLoan>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

beforeEach(() => {
  draftSeniorPersona.mockReset();
  hasConsent.mockReset();
  hasConsent.mockResolvedValue(true);
  embedQuery.mockReset();
  embedQuery.mockResolvedValue([0.1]);
});

describe("先輩のAIの名前", () => {
  it("年度+先輩+呼び名+(AI)", () => {
    expect(seniorDisplayName(2025, "ミナト")).toBe("2025年度の先輩 ミナト(AI)");
  });
});

describe("canUseArchived(同じ学校だけが使える)", () => {
  it("作った先生と、同じ組織の先生は使える", () => {
    expect(canUseArchived({ created_by: "t1", organization_id: null }, "t1", null)).toBe(true);
    expect(canUseArchived({ created_by: "t1", organization_id: "o1" }, "t2", "o1")).toBe(true);
  });
  it("別の組織の先生や、組織の無い別の先生は使えない", () => {
    expect(canUseArchived({ created_by: "t1", organization_id: "o1" }, "t2", "o2")).toBe(false);
    expect(canUseArchived({ created_by: "t1", organization_id: null }, "t2", null)).toBe(false);
  });
});

const senior = { id: "p1", tier: "senior", status: "approved", course_id: null, created_by: "t1", organization_id: "o1" };

describe("addLoan(授業回に加える)", () => {
  it("同じ学校の、承認済みの先輩のAIなら加えられる", async () => {
    const admin = fakeAdmin({
      tables: { courses: [{ id: "c1", owner_teacher_id: "t2" }], personas: [senior], profiles: [{ organization_id: "o1" }], persona_loans: [] },
    });
    await addLoan(asAdmin(admin), { teacherId: "t2", courseId: "c1", personaId: "p1", mode: "then" });
    expect(admin.log.find((l) => l.startsWith("insert:persona_loans"))).toContain('"scope":"same_school"');
  });
  it("別の学校の先生は加えられない", async () => {
    const admin = fakeAdmin({
      tables: { courses: [{ id: "c1", owner_teacher_id: "t9" }], personas: [senior], profiles: [{ organization_id: "o9" }], persona_loans: [] },
    });
    await expect(addLoan(asAdmin(admin), { teacherId: "t9", courseId: "c1", personaId: "p1", mode: "then" })).rejects.toBeInstanceOf(SeniorRuleError);
    expect(admin.log).toEqual([]);
  });
  it("下書きのままでは加えられない", async () => {
    const admin = fakeAdmin({
      tables: { courses: [{ id: "c1", owner_teacher_id: "t1" }], personas: [{ ...senior, status: "draft" }], profiles: [{ organization_id: "o1" }] },
    });
    await expect(addLoan(asAdmin(admin), { teacherId: "t1", courseId: "c1", personaId: "p1", mode: "then" })).rejects.toThrow("承認済み");
  });
  it("自分の授業回でなければ加えられない", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ id: "c1", owner_teacher_id: "other" }], personas: [senior] } });
    await expect(addLoan(asAdmin(admin), { teacherId: "t1", courseId: "c1", personaId: "p1", mode: "then" })).rejects.toThrow("権限");
  });
  it("1つの授業回に加えられる数には上限がある", async () => {
    const admin = fakeAdmin({
      tables: {
        courses: [{ id: "c1", owner_teacher_id: "t1" }],
        personas: [senior],
        profiles: [{ organization_id: "o1" }],
        persona_loans: Array.from({ length: MAX_LOANS_PER_LESSON }, (_, i) => ({ id: `l${i}` })),
      },
    });
    await expect(addLoan(asAdmin(admin), { teacherId: "t1", courseId: "c1", personaId: "p1", mode: "then" })).rejects.toThrow("まで");
  });
  it("授業回のペルソナ(先輩型でないもの)は加えられない", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ id: "c1", owner_teacher_id: "t1" }], personas: [{ ...senior, tier: "teacher_defined", course_id: "c0" }] } });
    await expect(addLoan(asAdmin(admin), { teacherId: "t1", courseId: "c1", personaId: "p1", mode: "then" })).rejects.toThrow("見つかりません");
  });
});

describe("createSeniorDraft(記録から下書きを作る)", () => {
  const project = { id: "pr1", title: "防災班", theme: "避難所", kind: "group", solo_student_id: null, owner_teacher_id: "t1", fiscal_year: 2025 };
  it("自分のシリーズの探究でなければ作れない(AIを呼ばない)", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ ...project, owner_teacher_id: "t2" }] } });
    await expect(createSeniorDraft(asAdmin(admin), { teacherId: "t1", projectId: "pr1", nickname: "ミナト" })).rejects.toBeInstanceOf(SeniorRuleError);
    expect(draftSeniorPersona).not.toHaveBeenCalled();
  });
  it("同意していない学習者の個人の探究からは作れない(AIを呼ばない)", async () => {
    hasConsent.mockResolvedValue(false);
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ ...project, kind: "solo", solo_student_id: "u1" }], profiles: [{ test_owner_id: null }] } });
    await expect(createSeniorDraft(asAdmin(admin), { teacherId: "t1", projectId: "pr1", nickname: "ミナト" })).rejects.toThrow("同意");
    expect(draftSeniorPersona).not.toHaveBeenCalled();
  });
  it("軌跡ができていなければ作れない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [project], inquiry_trajectories: [] } });
    await expect(createSeniorDraft(asAdmin(admin), { teacherId: "t1", projectId: "pr1", nickname: "ミナト" })).rejects.toThrow("軌跡");
  });
  it("下書き(授業回に属さない先輩型)として保存する", async () => {
    draftSeniorPersona.mockResolvedValue({ role: "r", tone: "t", position: "p", goal: "g" });
    const admin = fakeAdmin({
      tables: {
        inquiry_projects: [project],
        inquiry_trajectories: [{ id: "tr", body: "流れ", version: 1, up_to_stage_key: "analysis" }],
        inquiry_stage_stories: [{ stage_key: "problem_setting" }],
        profiles: [{ organization_id: "o1" }],
      },
    });
    await createSeniorDraft(asAdmin(admin), { teacherId: "t1", projectId: "pr1", nickname: " ミナト " });
    const insert = admin.log.find((l) => l.startsWith("insert:personas"))!;
    expect(insert).toContain('"tier":"senior"');
    expect(insert).toContain('"status":"draft"');
    expect(insert).toContain('"course_id":null');
    expect(insert).toContain("2025年度の先輩 ミナト(AI)");
  });
});

describe("updateSeniorPersona", () => {
  it("作った先生だけが直せる", async () => {
    const admin = fakeAdmin({ tables: { personas: [senior] } });
    await expect(
      updateSeniorPersona(asAdmin(admin), { teacherId: "t2", personaId: "p1", nickname: "x", role: "", tone: "", position: "", goal: "" }),
    ).rejects.toThrow("作った先生");
  });
});

describe("先輩の記憶(当時モードと振り返りモード)", () => {
  const rows = [
    { id: "a", body: "課題設定まで", version: 1, kind: "live", up_to_stage_key: "problem_setting" },
    { id: "b", body: "分析まで", version: 3, kind: "live", up_to_stage_key: "analysis" },
    { id: "r", body: "振り返り", version: 1, kind: "retrospective", up_to_stage_key: null },
  ];
  it("当時モードは、後輩のいまの段階までの軌跡しか使わない(結論を先取りしない)", () => {
    expect(pickThenTrajectory(rows, "information_gathering")?.id).toBe("a");
    expect(pickThenTrajectory(rows, "expression")?.id).toBe("b");
  });
  it("振り返りモードは、振り返り版を使う", () => {
    expect(pickRetrospectiveTrajectory(rows)?.id).toBe("r");
    expect(pickRetrospectiveTrajectory(rows.filter((r) => r.kind === "live"))?.id).toBe("b");
  });
  it("当時モードは、後輩のいまの段階までのエピソードだけを検索する", async () => {
    const admin = fakeAdmin({ tables: { inquiry_trajectories: rows, inquiry_stage_stories: [] }, rpc: { match_inquiry_episodes: [] } });
    await buildSeniorMemory(asAdmin(admin), { projectId: "pr1", mode: "then", juniorStageKey: "information_gathering", queryEmbedding: [0.1] });
    expect(admin.rpcCalls[0].args).toMatchObject({ p_stage_keys: ["problem_setting", "information_gathering"], p_kind: "narrated", p_match_count: 1 });
  });
  it("振り返りモードは、すべての段階から検索する。使った記録を返す", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_trajectories: rows, inquiry_stage_stories: [{ id: "s1", body: "物語", kind: "retrospective", version: 1 }] },
      rpc: { match_inquiry_episodes: [{ episode_id: "e", version_id: "v", stage_key: "analysis", context_header: "h", body: "場面", similarity: 0.8 }] },
    });
    const memory = await buildSeniorMemory(asAdmin(admin), { projectId: "pr1", mode: "retrospective", juniorStageKey: "problem_setting", queryEmbedding: [0.1] });
    expect(admin.rpcCalls[0].args).toMatchObject({ p_stage_keys: null });
    expect(memory.retrievals.map((r) => r.kind)).toEqual(["trajectory", "episode", "stage_story"]);
    expect(memory.text).toContain("場面");
    expect(memory.text).toContain("覚えていない");
  });
});

describe("loadActiveMembers(授業回で話す擬似メンバー)", () => {
  it("授業回のペルソナのあとに、承認済みの先輩のAIを並べる。下書きに戻された先輩は話さない", async () => {
    const admin = fakeAdmin({
      sequences: {
        personas: [
          [{ id: "own", name: "授業のペルソナ", status: "active" }],
          [
            { id: "s1", name: "先輩A", status: "approved", source_project_id: "pr1", tier: "senior" },
            { id: "s2", name: "先輩B", status: "draft", source_project_id: "pr1", tier: "senior" },
          ],
        ],
      },
      tables: {
        persona_loans: [
          { id: "l1", persona_id: "s1", mode: "then" },
          { id: "l2", persona_id: "s2", mode: "then" },
        ],
        inquiry_projects: [{ id: "pr1", solo_student_id: null }],
      },
    });
    const members = await loadActiveMembers(asAdmin(admin), "c1");
    expect(members.map((m) => m.id)).toEqual(["own", "s1"]);
    expect(members[1].loan).toEqual({ id: "l1", mode: "then" });
  });
  it("個人の探究から作った先輩は、その学習者が同意を撤回したら話さない", async () => {
    hasConsent.mockResolvedValue(false);
    const admin = fakeAdmin({
      sequences: { personas: [[], [{ id: "s1", name: "先輩A", status: "approved", source_project_id: "pr1", tier: "senior" }]] },
      tables: {
        persona_loans: [{ id: "l1", persona_id: "s1", mode: "then" }],
        inquiry_projects: [{ id: "pr1", solo_student_id: "u1" }],
        profiles: [{ test_owner_id: null }],
      },
    });
    expect(await loadActiveMembers(asAdmin(admin), "c1")).toEqual([]);
  });
});

describe("retrieveForTurn(費用)", () => {
  it("先輩がいなければ、教材を5件検索するだけ", async () => {
    const result = await retrieveForTurn(asAdmin(fakeAdmin()), { courseId: "c1", members: [{ id: "a", name: "a", profile: null, stance: null, behavior_rules: null }], queryText: "q", juniorProjectId: null });
    expect(result.materialChunks).toEqual(["教材5件"]);
    expect(embedQuery).not.toHaveBeenCalled();
  });
  it("先輩がいれば、埋め込みを1回だけ作って共用し、教材は3件に減らす", async () => {
    const admin = fakeAdmin({ tables: { inquiry_trajectories: [], inquiry_projects: [{ current_stage_key: "analysis" }] }, rpc: { match_inquiry_episodes: [] } });
    const seniorMember = { id: "s", name: "先輩", profile: null, stance: null, behavior_rules: null, sourceProjectId: "pr1", loan: { id: "l", mode: "then" as const } };
    const result = await retrieveForTurn(asAdmin(admin), { courseId: "c1", members: [seniorMember, { ...seniorMember, id: "s2" }], queryText: "q", juniorProjectId: "jr" });
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(result.materialChunks).toEqual(["教材3件"]);
    expect([...result.memories.keys()].sort()).toEqual(["s", "s2"]);
  });
});
