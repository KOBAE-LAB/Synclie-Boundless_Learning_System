import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "./fake-admin";

const draftAggregatePersona = vi.fn();
vi.mock("@/lib/ai/aggregate-persona", () => ({ draftAggregatePersona: (...args: unknown[]) => draftAggregatePersona(...args) }));
vi.mock("@/lib/ai/senior-persona-draft", () => ({ draftSeniorPersona: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ MODEL_JUDGE: "m", MODEL_EMBEDDING: "e", openai: {} }));
const hasConsent = vi.fn();
vi.mock("@/lib/consent", () => ({ hasConsent: (...args: unknown[]) => hasConsent(...args) }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/rag/search", () => ({
  embedQuery: async () => [0.1],
  searchMaterialChunks: async () => ["教材5件"],
  searchMaterialChunksByEmbedding: async () => ["教材3件"],
}));

import { aggregateStillSpeaks, buildMaterialsText, createAggregateDraft, invalidateAggregatesForStudent } from "./aggregate";
import { SeniorRuleError } from "./senior";
import { loadActiveMembers, retrieveForTurn, type LessonMember } from "@/lib/learn/members";

type Admin = Parameters<typeof createAggregateDraft>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

const series = { id: "s1", title: "社会", fiscal_year: 2025, owner_teacher_id: "t1" };
const solo = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, kind: "solo", solo_student_id: `u${i + 1}` }));
const traj = (n: number) => Array.from({ length: n }, (_, i) => ({ project_id: `p${i + 1}`, kind: "retrospective", version: 1, body: `流れ${i + 1}` }));
const draft = {
  role: "去年の多くの人がつまずいた点を知っている仲間",
  tone: "くだけた敬語",
  position: "条件を絞ってから案を考える",
  goal: "共通のつまずきを材料に問い返す",
  items: [{ kind: "stumble", text: "多くの人が、条件を絞る前に案を決めようとした", lessonNo: 2 }],
};

beforeEach(() => {
  draftAggregatePersona.mockReset();
  draftAggregatePersona.mockResolvedValue(draft);
  hasConsent.mockReset();
  hasConsent.mockResolvedValue(true);
});

describe("createAggregateDraft(集約型の下書き)", () => {
  it("自分の教科・科目でなければ作れない(AIを呼ばない)", async () => {
    const admin = fakeAdmin({ tables: { course_series: [{ ...series, owner_teacher_id: "other" }] } });
    await expect(createAggregateDraft(asAdmin(admin), { teacherId: "t1", seriesId: "s1" })).rejects.toBeInstanceOf(SeniorRuleError);
    expect(draftAggregatePersona).not.toHaveBeenCalled();
  });
  it("同意した学習者が3人分に満たなければ、作れない(AIを呼ばない)", async () => {
    const admin = fakeAdmin({
      tables: { course_series: [series], inquiry_projects: solo(3), inquiry_trajectories: traj(3), inquiry_episodes: [], inquiry_project_members: [], profiles: [{ test_owner_id: null }] },
    });
    hasConsent.mockImplementation(async (_a: unknown, id: string) => id !== "u3"); // 3人のうち1人は同意していない → 2人分
    await expect(createAggregateDraft(asAdmin(admin), { teacherId: "t1", seriesId: "s1" })).rejects.toThrow(/3人分以上/);
    expect(draftAggregatePersona).not.toHaveBeenCalled();
  });
  it("3人分あれば、下書き(授業回に属さない集約型)と材料の対応を保存する。AIに渡すのは要約だけ(学習者のidは渡さない)", async () => {
    const admin = fakeAdmin({
      tables: { course_series: [series], inquiry_projects: solo(3), inquiry_trajectories: traj(3), inquiry_episodes: [], inquiry_project_members: [], profiles: [{ test_owner_id: null, organization_id: "o1" }] },
    });
    const { personaId } = await createAggregateDraft(asAdmin(admin), { teacherId: "t1", seriesId: "s1", nickname: "ミライ" });
    expect(personaId).toBeTruthy();
    const persona = admin.log.find((l) => l.startsWith("insert:personas:"))!;
    expect(persona).toContain('"tier":"aggregate"');
    expect(persona).toContain('"status":"draft"');
    expect(persona).toContain('"course_id":null');
    expect(persona).toContain("2025年度のみんな ミライ(AI)");
    expect(persona).toContain('"items"');
    expect(admin.log.filter((l) => l.startsWith("insert:persona_source_projects:"))).toHaveLength(1);
    expect(draftAggregatePersona).toHaveBeenCalledTimes(1);
    const sent = draftAggregatePersona.mock.calls[0][0] as { materials: string };
    expect(sent.materials).toContain("流れ1");
    expect(sent.materials).not.toMatch(/u[123]/);
  });
});

describe("buildMaterialsText(AIに渡す材料)", () => {
  it("軌跡と場面だけを並べ、長さに上限がある", () => {
    const projects = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      trajectory: "あ".repeat(900),
      episodes: [{ lessonNo: 2, header: "見出し", body: "い".repeat(500) }],
      studentIds: ["u1"],
    }));
    const text = buildMaterialsText(projects);
    expect(text.length).toBeLessThanOrEqual(9100);
    expect(text).toContain("場面(第2回)");
    expect(text).not.toContain("u1");
  });
});

describe("aggregateStillSpeaks(同意した学習者が3人以上いる間だけ話す)", () => {
  const tables = {
    persona_source_projects: [{ project_id: "p1" }, { project_id: "p2" }, { project_id: "p3" }],
    inquiry_project_members: [],
    inquiry_projects: solo(3),
    profiles: [{ test_owner_id: null }],
  };
  it("3人とも同意していれば話す", async () => {
    expect(await aggregateStillSpeaks(asAdmin(fakeAdmin({ tables })), "a1")).toBe(true);
  });
  it("1人が同意を撤回して2人になれば、話さない", async () => {
    hasConsent.mockImplementation(async (_a: unknown, id: string) => id !== "u2");
    expect(await aggregateStillSpeaks(asAdmin(fakeAdmin({ tables })), "a1")).toBe(false);
  });
  it("材料が無ければ、話さない", async () => {
    expect(await aggregateStillSpeaks(asAdmin(fakeAdmin({ tables: { ...tables, persona_source_projects: [] } })), "a1")).toBe(false);
  });
});

describe("invalidateAggregatesForStudent(学習者本人の全データ削除の前)", () => {
  it("本人の記録が材料に入っている承認済みの集約型を、下書きに戻す", async () => {
    const admin = fakeAdmin({
      tables: {
        inquiry_projects: [{ id: "p1" }],
        inquiry_project_members: [{ project_id: "g1" }],
        persona_source_projects: [{ persona_id: "a1" }],
        personas: [{ id: "a1" }],
      },
    });
    expect(await invalidateAggregatesForStudent(asAdmin(admin), "u1")).toBe(1);
    const update = admin.log.find((l) => l.startsWith("update:personas:"))!;
    expect(update).toContain('"status":"draft"');
  });
  it("本人の記録が材料に入っていなければ、何もしない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [], inquiry_project_members: [], persona_source_projects: [], personas: [] } });
    expect(await invalidateAggregatesForStudent(asAdmin(admin), "u1")).toBe(0);
    expect(admin.log.filter((l) => l.startsWith("update:"))).toEqual([]);
  });
});

describe("授業回で話す集約型(loadActiveMembers / retrieveForTurn)", () => {
  const aggregate = {
    id: "a1",
    tier: "aggregate",
    status: "approved",
    name: "2025年度のみんな(AI)",
    profile: { role: "r", tone: "t" },
    stance: {
      position: "p",
      goal: "g",
      items: [
        { kind: "stumble", text: "第2回のつまずき", lessonNo: 2 },
        { kind: "misconception", text: "第5回の誤解", lessonNo: 5 },
        { kind: "good_question", text: "全体の有効な問い", lessonNo: null },
      ],
    },
    behavior_rules: {},
    source_project_id: null,
  };
  const sources = {
    persona_source_projects: [{ project_id: "p1" }, { project_id: "p2" }, { project_id: "p3" }],
    inquiry_project_members: [],
    inquiry_projects: solo(3),
    profiles: [{ test_owner_id: null }],
  };

  it("承認済みで、同意した学習者が3人以上いれば話す。人数が足りなくなったら話さない", async () => {
    const make = () => fakeAdmin({ tables: { persona_loans: [{ id: "l1", persona_id: "a1", mode: "then" }], ...sources }, sequences: { personas: [[], [aggregate]] } });
    expect((await loadActiveMembers(asAdmin(make()), "c1")).map((m) => m.id)).toEqual(["a1"]);
    hasConsent.mockImplementation(async (_a: unknown, id: string) => id !== "u1");
    expect(await loadActiveMembers(asAdmin(make()), "c1")).toEqual([]);
  });
  it("下書きに戻された集約型は話さない", async () => {
    const admin = fakeAdmin({
      tables: { persona_loans: [{ id: "l1", persona_id: "a1", mode: "then" }], ...sources },
      sequences: { personas: [[], [{ ...aggregate, status: "draft" }]] },
    });
    expect(await loadActiveMembers(asAdmin(admin), "c1")).toEqual([]);
  });
  it("教科・科目学習モードでは、後輩のいまの授業回までの項目だけを記憶に入れる。探究学習モードでは絞らない", async () => {
    const member = { ...aggregate, sourceProjectId: null, loan: { id: "l1", mode: "then" } } as unknown as LessonMember;
    const standard = fakeAdmin({ tables: { courses: [{ lesson_no: 3, series_id: "s1" }], course_series: [{ kind: "standard" }] } });
    const r1 = await retrieveForTurn(asAdmin(standard), { courseId: "c1", members: [member], queryText: "質問", juniorProjectId: null });
    const text1 = r1.memories.get("a1")!.memory.text;
    expect(text1).toContain("第2回のつまずき");
    expect(text1).toContain("全体の有効な問い");
    expect(text1).not.toContain("第5回の誤解");
    expect(r1.memories.get("a1")!.memory.retrievals).toEqual([{ kind: "aggregate" }]);
    const inquiry = fakeAdmin({ tables: { courses: [{ lesson_no: 3, series_id: "s1" }], course_series: [{ kind: "inquiry" }] } });
    const r2 = await retrieveForTurn(asAdmin(inquiry), { courseId: "c1", members: [member], queryText: "質問", juniorProjectId: null });
    expect(r2.memories.get("a1")!.memory.text).toContain("第5回の誤解");
  });
});
