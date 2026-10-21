import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "./fake-admin";

// AIとDBの外側は偽物にする: AIが呼ばれたかどうか(費用の境界)と、何が書き込まれたかだけを見る。
const extractEpisodes = vi.fn();
vi.mock("@/lib/ai/episode-extraction", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/episode-extraction")>()),
  extractEpisodes: (...args: unknown[]) => extractEpisodes(...args),
}));
vi.mock("@/lib/ai/openai", () => ({
  MODEL_JUDGE: "gpt-5.6-luna",
  MODEL_EMBEDDING: "text-embedding-3-small",
  openai: { embeddings: { create: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) } },
}));
const hasConsent = vi.fn();
vi.mock("@/lib/consent", () => ({ hasConsent: (...args: unknown[]) => hasConsent(...args) }));
vi.mock("next/server", () => ({ after: () => undefined }));

import { loadOwnTurnSession } from "./markers";
import { runJob, type JobRow } from "./pipeline";
import { jobDedupeKey, monthStartJst, runPendingJobs } from "./queue";
import { transitionStage } from "./project-stage";
import { forgetStudentInGroups } from "./forget";

type Admin = Parameters<typeof runJob>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

const job = (overrides: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  kind: "extract_session",
  project_id: "p1",
  session_id: "s1",
  stage_key: null,
  prompt_version: "episodes-v1",
  status: "running",
  attempts: 1,
  ...overrides,
});

const sessionTables = (extra: Record<string, Record<string, unknown>[]> = {}): Record<string, Record<string, unknown>[]> => ({
  learning_sessions: [{ id: "s1", student_id: "u1", course_id: "c1", project_id: "p1", started_at: "2026-10-21T00:00:00Z" }],
  profiles: [{ test_owner_id: null, display_name: "山田 太郎", organization_id: null }],
  dialogue_turns: [
    { id: "t1", speaker_type: "student", content: "葉で作ると思う", persona_name: null },
    { id: "t2", speaker_type: "persona", content: "根拠は?", persona_name: "コウタ" },
  ],
  inquiry_projects: [{ id: "p1", title: "理科1年", theme: null, current_stage_key: "problem_setting", created_at: "2026-10-01T00:00:00Z", owner_teacher_id: "teacher", kind: "solo", solo_student_id: "u1" }],
  ...extra,
});

beforeEach(() => {
  extractEpisodes.mockReset();
  hasConsent.mockReset();
  hasConsent.mockResolvedValue(true);
});

describe("loadOwnTurnSession(印を付けてよい発言の境界)", () => {
  const tables = {
    dialogue_turns: [{ id: "t1", session_id: "s1" }],
    learning_sessions: [{ id: "s1", student_id: "u1", course_id: "c1", ended_at: null, project_id: "p1" }],
  };
  it("本人の、その授業回の議論の発言なら、その議論を返す", async () => {
    expect(await loadOwnTurnSession(asAdmin(fakeAdmin({ tables })), { turnId: "t1", studentId: "u1", courseId: "c1" })).toEqual({
      id: "s1",
      ended_at: null,
      project_id: "p1",
    });
  });
  it("他人の議論の発言には付けられない", async () => {
    expect(await loadOwnTurnSession(asAdmin(fakeAdmin({ tables })), { turnId: "t1", studentId: "u2", courseId: "c1" })).toBeNull();
  });
  it("グループの議論は、いまのメンバーなら付けられる", async () => {
    const groupTables = {
      dialogue_turns: [{ id: "t1", session_id: "s1" }],
      learning_sessions: [{ id: "s1", student_id: null, course_id: "c1", ended_at: null, project_id: "g1" }],
      inquiry_project_members: [{ student_id: "u2" }],
    };
    expect(await loadOwnTurnSession(asAdmin(fakeAdmin({ tables: groupTables })), { turnId: "t1", studentId: "u2", courseId: "c1" })).toEqual({
      id: "s1",
      ended_at: null,
      project_id: "g1",
    });
  });
  it("グループの議論でも、メンバーでなければ付けられない", async () => {
    const groupTables = {
      dialogue_turns: [{ id: "t1", session_id: "s1" }],
      learning_sessions: [{ id: "s1", student_id: null, course_id: "c1", ended_at: null, project_id: "g1" }],
      inquiry_project_members: [],
    };
    expect(await loadOwnTurnSession(asAdmin(fakeAdmin({ tables: groupTables })), { turnId: "t1", studentId: "u9", courseId: "c1" })).toBeNull();
  });
  it("別の授業回のURLからは付けられない", async () => {
    expect(await loadOwnTurnSession(asAdmin(fakeAdmin({ tables })), { turnId: "t1", studentId: "u1", courseId: "c2" })).toBeNull();
  });
});

describe("extract_session(費用と同意の境界)", () => {
  it("印が1つも無い議論では、AIを呼ばずに対象外にする", async () => {
    const admin = fakeAdmin({ tables: sessionTables({ inquiry_markers: [] }) });
    expect(await runJob(asAdmin(admin), job())).toBe("skipped");
    expect(extractEpisodes).not.toHaveBeenCalled();
  });
  it("データ利用に同意していない学習者の議論は、AIを呼ばずに対象外にする", async () => {
    hasConsent.mockResolvedValue(false);
    const admin = fakeAdmin({ tables: sessionTables({ inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }] }) });
    expect(await runJob(asAdmin(admin), job())).toBe("skipped");
    expect(extractEpisodes).not.toHaveBeenCalled();
  });
  it("管理者のテスト学習者の議論は対象外にする", async () => {
    const tables = sessionTables({ inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }] });
    tables.profiles = [{ test_owner_id: "admin", display_name: "テスト", organization_id: null }];
    expect(await runJob(asAdmin(fakeAdmin({ tables })), job())).toBe("skipped");
    expect(extractEpisodes).not.toHaveBeenCalled();
  });
  it("印があれば1回だけAIを呼び、語りの名前を伏せ、原文の抜粋と出典を書く", async () => {
    extractEpisodes.mockResolvedValue([
      { type: "stuck", startTurn: 1, endTurn: 2, contextHeader: "見出し", narrative: "山田太郎として、自分は根拠に迷った。" },
    ]);
    const admin = fakeAdmin({ tables: sessionTables({ inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }] }) });
    expect(await runJob(asAdmin(admin), job())).toBe("done");
    expect(extractEpisodes).toHaveBeenCalledTimes(1);
    const versions = admin.log.find((l) => l.startsWith("insert:inquiry_episode_versions"))!;
    expect(versions).toContain("〇〇として");
    expect(versions).not.toContain("山田太郎として");
    expect(versions).toContain('"kind":"excerpt"');
    expect(admin.log.find((l) => l.startsWith("insert:inquiry_episodes"))).toContain('"picked_by":"student"');
    expect(admin.log.some((l) => l.startsWith("insert:inquiry_sources"))).toBe(true);
  });
});

describe("extract_session(探究のグループの議論、0044)", () => {
  const groupTables = (): Record<string, Record<string, unknown>[]> => ({
    learning_sessions: [{ id: "s1", student_id: null, course_id: "c1", project_id: "g1", started_at: "2026-10-21T00:00:00Z" }],
    profiles: [{ test_owner_id: null, display_name: "山田 太郎", organization_id: null }],
    dialogue_turns: [
      { id: "t1", speaker_type: "student", content: "葉で作ると思う", persona_name: null, author_student_id: "u1" },
      { id: "t2", speaker_type: "student", content: "同意していない人の発言", persona_name: null, author_student_id: "u2" },
      { id: "t3", speaker_type: "persona", content: "根拠は?", persona_name: "コウタ", author_student_id: null },
    ],
    inquiry_projects: [{ id: "g1", title: "防災班", theme: "避難所", current_stage_key: "analysis", created_at: "2026-10-01T00:00:00Z", owner_teacher_id: "teacher", kind: "group", solo_student_id: null }],
    inquiry_project_members: [{ student_id: "u1" }, { student_id: "u2" }],
    inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }],
  });
  it("同意していないメンバーの発言は、AIに渡さない。発言者は仮の呼び名", async () => {
    hasConsent.mockImplementation(async (_admin: unknown, id: string) => id === "u1");
    extractEpisodes.mockResolvedValue([]);
    expect(await runJob(asAdmin(fakeAdmin({ tables: groupTables() })), job({ project_id: "g1" }))).toBe("done");
    const input = extractEpisodes.mock.calls[0][0] as { transcript: string };
    expect(input.transcript).toContain("学習者(メンバーA): 葉で作ると思う");
    expect(input.transcript).not.toContain("同意していない人の発言");
  });
  it("同意しているメンバーの発言が無ければ、AIを呼ばない", async () => {
    hasConsent.mockResolvedValue(false);
    expect(await runJob(asAdmin(fakeAdmin({ tables: groupTables() })), job({ project_id: "g1" }))).toBe("skipped");
    expect(extractEpisodes).not.toHaveBeenCalled();
  });
  it("作り直しでは、仕事に書いた段階にエピソードを置く", async () => {
    hasConsent.mockResolvedValue(true);
    extractEpisodes.mockResolvedValue([{ type: "stuck", startTurn: 1, endTurn: 1, contextHeader: "h", narrative: "n" }]);
    const admin = fakeAdmin({ tables: groupTables() });
    await runJob(asAdmin(admin), job({ project_id: "g1", stage_key: "problem_setting" }));
    expect(admin.log.find((l) => l.startsWith("insert:inquiry_episodes"))).toContain('"stage_key":"problem_setting"');
  });
});

describe("forgetStudentInGroups(本人の全データ削除のうち、グループの議論)", () => {
  it("本人の発言と、そこから作った抽出層を消し、元の段階で作り直しを積む", async () => {
    const admin = fakeAdmin({
      tables: {
        dialogue_turns: [{ id: "t1", session_id: "s1", source_kind: "audio", source_path: "a/1.webm" }],
        learning_sessions: [{ id: "s1", project_id: "g1" }],
        inquiry_episodes: [{ id: "e1", session_id: "s1", stage_key: "analysis" }],
        inquiry_stage_stories: [{ id: "st1", project_id: "g1", stage_key: "analysis", kind: "live" }],
        inquiry_trajectories: [{ id: "tr1", kind: "live" }],
      },
    });
    const result = await forgetStudentInGroups(asAdmin(admin), "u1");
    expect(result).toMatchObject({ turnsDeleted: 1, audioPaths: ["a/1.webm"], rebuiltProjectIds: ["g1"] });
    for (const table of ["inquiry_sources", "inquiry_episodes", "inquiry_stage_stories", "inquiry_trajectories", "dialogue_turns"]) {
      expect(admin.log).toContain(`delete:${table}`);
    }
    // 議論(セッション)そのものは消さない(メンバーと共有しているため)
    expect(admin.log).not.toContain("delete:learning_sessions");
    const jobs = admin.log.filter((l) => l.startsWith("insert:inquiry_jobs"));
    expect(jobs[0]).toContain('"kind":"extract_session"');
    expect(jobs[0]).toContain('"stage_key":"analysis"');
    expect(jobs[1]).toContain('"kind":"build_stage_story"');
  });
  it("グループの議論での発言が無ければ、何もしない", async () => {
    const admin = fakeAdmin({ tables: { dialogue_turns: [] } });
    expect((await forgetStudentInGroups(asAdmin(admin), "u1")).turnsDeleted).toBe(0);
    expect(admin.log).toEqual([]);
  });
});

describe("runPendingJobs(月の上限)", () => {
  it("上限を超えていたら、AIを呼ばずに後回しにする", async () => {
    vi.stubEnv("SYNCLIE_MONTHLY_AI_BUDGET_USD", "10");
    const admin = fakeAdmin({
      tables: { inquiry_jobs: [{ ...job({ status: "pending", attempts: 0 }) }], ...sessionTables({ inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }] }) },
      rpc: { ai_usage_cost_since: 12.5 },
    });
    await runPendingJobs(asAdmin(admin));
    expect(admin.log.some((l) => l.includes('"status":"deferred"'))).toBe(true);
    expect(extractEpisodes).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("ほかの処理が先に取った仕事は処理しない(二重に処理しない)", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_jobs: [{ ...job({ status: "pending", attempts: 0 }) }], ...sessionTables({ inquiry_markers: [{ turn_id: "t1", kind: "student_keep" }] }) },
      updateReturns: { inquiry_jobs: null },
    });
    await runPendingJobs(asAdmin(admin));
    expect(extractEpisodes).not.toHaveBeenCalled();
  });
});

describe("transitionStage", () => {
  it("段階が変わると切り替えを記録し、終わった段階の物語を作る仕事を積む", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ id: "p1", current_stage_key: "problem_setting" }] } });
    expect(await transitionStage(asAdmin(admin), { projectId: "p1", to: "information_gathering", decidedBy: "learner" })).toEqual({ changed: true });
    expect(admin.log.some((l) => l.startsWith("insert:inquiry_stage_transitions"))).toBe(true);
    const jobInsert = admin.log.find((l) => l.startsWith("insert:inquiry_jobs"))!;
    expect(jobInsert).toContain('"kind":"build_stage_story"');
    expect(jobInsert).toContain('"stage_key":"problem_setting"');
  });
  it("最初に段階を決めるとき(段階が無い状態から)は、物語は作らない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ id: "p1", current_stage_key: null }] } });
    await transitionStage(asAdmin(admin), { projectId: "p1", to: "problem_setting", decidedBy: "teacher_expected" });
    expect(admin.log.some((l) => l.startsWith("insert:inquiry_jobs"))).toBe(false);
  });
  it("同じ段階なら何もしない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ id: "p1", current_stage_key: "analysis" }] } });
    expect(await transitionStage(asAdmin(admin), { projectId: "p1", to: "analysis", decidedBy: "learner" })).toEqual({ changed: false });
    expect(admin.log).toEqual([]);
  });
});

describe("queue のユーティリティ", () => {
  it("同じ対象・同じプロンプトの版なら同じ鍵(二重に積まない)", () => {
    expect(jobDedupeKey({ kind: "extract_session", projectId: "p1", sessionId: "s1" })).toBe(
      jobDedupeKey({ kind: "extract_session", projectId: "p1", sessionId: "s1" }),
    );
    expect(jobDedupeKey({ kind: "extract_session", projectId: "p1", sessionId: "s1", round: "keep:t9" })).not.toBe(
      jobDedupeKey({ kind: "extract_session", projectId: "p1", sessionId: "s1" }),
    );
  });
  it("月の初めは日本時間で数える", () => {
    // 日本時間 2026-11-01 08:00 は、UTC では 10-31 23:00
    expect(monthStartJst(new Date("2026-10-31T23:00:00Z")).toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
});
