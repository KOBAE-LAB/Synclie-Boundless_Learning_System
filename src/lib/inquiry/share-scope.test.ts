import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "./fake-admin";

vi.mock("@/lib/ai/openai", () => ({ MODEL_JUDGE: "m", MODEL_EMBEDDING: "e", openai: {} }));
vi.mock("@/lib/ai/senior-persona-draft", () => ({ draftSeniorPersona: vi.fn() }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("./eligibility", () => ({ isEligibleLearner: async () => true }));
const enqueueJob = vi.fn();
vi.mock("./queue", () => ({ enqueueJob: (...args: unknown[]) => enqueueJob(...args) }));

import { decideScopeRequest, requestScopeChange } from "./share-scope";
import { SeniorRuleError } from "./senior";

type Admin = Parameters<typeof requestScopeChange>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

const persona = { id: "p1", tier: "senior", status: "approved", course_id: null, created_by: "t1", organization_id: "o1", share_scope: "school", source_project_id: "pr1" };
const org = { id: "o1", name: "A校", kind: "school", parent_organization_id: "city", verified: true, approver_teacher_id: "boss" };
const consented = { granted_at: "2026-10-25T00:00:00Z", withdrawn_at: null };
const tables = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  personas: [persona],
  organizations: [org],
  organization_network_members: [],
  inquiry_projects: [{ solo_student_id: "s1" }],
  inquiry_project_members: [],
  consent_records: [consented],
  ...over,
});

beforeEach(() => enqueueJob.mockReset());

describe("requestScopeChange(公開範囲を変える)", () => {
  it("同じ学校に戻すのは、承認なしですぐ変えられる(他校への貸し出しは止める)", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [{ ...persona, share_scope: "municipality" }] }) });
    const r = await requestScopeChange(asAdmin(admin), { teacherId: "t1", personaId: "p1", requested: "school" });
    expect(r.applied).toBe(true);
    expect(admin.log.some((l) => l.startsWith("update:personas:") && l.includes('"share_scope":"school"'))).toBe(true);
    expect(admin.log.some((l) => l.startsWith("update:persona_loans:") && l.includes('"status":"paused"'))).toBe(true);
  });
  it("広げるのは、申請として保存するだけ(承認されるまで有効にならない)", async () => {
    const admin = fakeAdmin({ tables: tables() });
    const r = await requestScopeChange(asAdmin(admin), { teacherId: "t1", personaId: "p1", requested: "municipality" });
    expect(r.applied).toBe(false);
    const update = admin.log.find((l) => l.startsWith("update:personas:"))!;
    expect(update).toContain('"scope_request":"municipality"');
    expect(update).not.toContain("share_scope");
  });
  it("作った先生以外は変えられない", async () => {
    const admin = fakeAdmin({ tables: tables() });
    await expect(requestScopeChange(asAdmin(admin), { teacherId: "t9", personaId: "p1", requested: "municipality" })).rejects.toBeInstanceOf(SeniorRuleError);
  });
  it("所属が確かめられていない組織は、広げる申請ができない", async () => {
    const admin = fakeAdmin({ tables: tables({ organizations: [{ ...org, verified: false }] }) });
    await expect(requestScopeChange(asAdmin(admin), { teacherId: "t1", personaId: "p1", requested: "municipality" })).rejects.toThrow("確かめられた");
  });
  it("材料の学習者の別の同意が無ければ、広げる申請ができない", async () => {
    const admin = fakeAdmin({ tables: tables({ consent_records: [] }) });
    await expect(requestScopeChange(asAdmin(admin), { teacherId: "t1", personaId: "p1", requested: "municipality" })).rejects.toThrow("同意");
    expect(admin.log.some((l) => l.startsWith("update:personas"))).toBe(false);
  });
  it("承認済みでない(下書きの)先輩のAIは、広げる申請ができない", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [{ ...persona, status: "draft" }] }) });
    await expect(requestScopeChange(asAdmin(admin), { teacherId: "t1", personaId: "p1", requested: "municipality" })).rejects.toThrow("承認済み");
  });
});

describe("decideScopeRequest(承認者の判断)", () => {
  const pending = { ...persona, scope_request: "municipality", scope_request_network_id: null };
  it("承認者でない先生は判断できない", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [pending] }) });
    await expect(decideScopeRequest(asAdmin(admin), { approverId: "someone", personaId: "p1", decision: "approved" })).rejects.toThrow("承認者");
    expect(admin.log).toEqual([]);
  });
  it("承認すると有効になり、他校向けの版づくりを積む", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [pending] }) });
    await decideScopeRequest(asAdmin(admin), { approverId: "boss", personaId: "p1", decision: "approved" });
    expect(admin.log.find((l) => l.startsWith("update:personas:"))).toContain('"share_scope":"municipality"');
    expect(enqueueJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "anonymize_episodes", projectId: "pr1" }));
  });
  it("承認の時点で同意が足りなければ、承認できない", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [pending], consent_records: [] }) });
    await expect(decideScopeRequest(asAdmin(admin), { approverId: "boss", personaId: "p1", decision: "approved" })).rejects.toThrow("同意");
    expect(enqueueJob).not.toHaveBeenCalled();
  });
  it("見送ると、申請だけを消して、範囲は変えない", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [pending] }) });
    await decideScopeRequest(asAdmin(admin), { approverId: "boss", personaId: "p1", decision: "declined" });
    const update = admin.log.find((l) => l.startsWith("update:personas:"))!;
    expect(update).toContain('"scope_request":null');
    expect(update).not.toContain("share_scope");
  });
  it("集約型は、他校向けの版づくりを積まない(まとめた項目だけを使う)", async () => {
    const admin = fakeAdmin({ tables: tables({ personas: [{ ...pending, tier: "aggregate", source_project_id: null }], persona_source_projects: [{ project_id: "pr1" }], inquiry_project_members: [{ student_id: "a" }, { student_id: "b" }, { student_id: "c" }] }) });
    await decideScopeRequest(asAdmin(admin), { approverId: "boss", personaId: "p1", decision: "approved" });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
