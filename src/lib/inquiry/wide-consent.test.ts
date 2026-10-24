import { describe, expect, it, vi } from "vitest";
import { fakeAdmin } from "./fake-admin";

vi.mock("./eligibility", () => ({ isEligibleLearner: vi.fn(async (_a: unknown, id: string) => id !== "nonconsenting") }));
import { hasWideConsent, invalidateWideScopeForStudent, wideConsentOk } from "./wide-consent";

describe("hasWideConsent", () => {
  it("同意があり、撤回していなければ true", async () => {
    const a = fakeAdmin({ tables: { consent_records: [{ granted_at: "2026-10-25T00:00:00Z", withdrawn_at: null }] } });
    expect(await hasWideConsent(a as never, "s1")).toBe(true);
  });
  it("同意が無い・撤回済みなら false", async () => {
    expect(await hasWideConsent(fakeAdmin({ tables: { consent_records: [] } }) as never, "s1")).toBe(false);
    const withdrawn = fakeAdmin({ tables: { consent_records: [{ granted_at: "2026-10-25T00:00:00Z", withdrawn_at: "2026-10-26T00:00:00Z" }] } });
    expect(await hasWideConsent(withdrawn as never, "s1")).toBe(false);
  });
});

describe("wideConsentOk", () => {
  it("先輩型: 材料の学習者が全員、別の同意をしていれば true", async () => {
    const a = fakeAdmin({
      tables: {
        inquiry_project_members: [],
        inquiry_projects: [{ solo_student_id: "s1" }],
        consent_records: [{ granted_at: "2026-10-25T00:00:00Z", withdrawn_at: null }],
      },
    });
    expect(await wideConsentOk(a as never, { id: "p", tier: "senior", source_project_id: "proj" })).toBe(true);
  });
  it("先輩型: 別の同意が無ければ false", async () => {
    const a = fakeAdmin({ tables: { inquiry_project_members: [], inquiry_projects: [{ solo_student_id: "s1" }], consent_records: [] } });
    expect(await wideConsentOk(a as never, { id: "p", tier: "senior", source_project_id: "proj" })).toBe(false);
  });
  it("先輩型: データ利用に同意していない学習者は、材料に入らないので、数えない", async () => {
    const a = fakeAdmin({ tables: { inquiry_project_members: [], inquiry_projects: [{ solo_student_id: "nonconsenting" }], consent_records: [] } });
    expect(await wideConsentOk(a as never, { id: "p", tier: "senior", source_project_id: "proj" })).toBe(false); // 材料の学習者がいない
  });
  it("集約型: 同意した学習者が3人に満たなければ false", async () => {
    const a = fakeAdmin({
      tables: {
        persona_source_projects: [{ project_id: "p1" }],
        inquiry_project_members: [{ student_id: "s1" }, { student_id: "s2" }],
        inquiry_projects: [],
        consent_records: [{ granted_at: "2026-10-25T00:00:00Z", withdrawn_at: null }],
      },
    });
    expect(await wideConsentOk(a as never, { id: "agg", tier: "aggregate" })).toBe(false);
  });
  it("集約型: 3人が全員、別の同意をしていれば true", async () => {
    const a = fakeAdmin({
      tables: {
        persona_source_projects: [{ project_id: "p1" }],
        inquiry_project_members: [{ student_id: "s1" }, { student_id: "s2" }, { student_id: "s3" }],
        inquiry_projects: [],
        consent_records: [{ granted_at: "2026-10-25T00:00:00Z", withdrawn_at: null }],
      },
    });
    expect(await wideConsentOk(a as never, { id: "agg", tier: "aggregate" })).toBe(true);
  });
});

describe("invalidateWideScopeForStudent", () => {
  it("材料に入っている先輩のAIを、同じ学校の範囲に戻し、他校への貸し出しを止める", async () => {
    const a = fakeAdmin({
      tables: {
        inquiry_projects: [{ id: "proj" }],
        inquiry_project_members: [],
        personas: [{ id: "pers" }],
        persona_source_projects: [],
      },
    });
    const n = await invalidateWideScopeForStudent(a as never, "s1");
    expect(n).toBe(1);
    expect(a.log.some((l) => l.startsWith("update:personas:") && l.includes('"share_scope":"school"'))).toBe(true);
    expect(a.log.some((l) => l.startsWith("update:persona_loans:") && l.includes('"status":"paused"'))).toBe(true);
  });
  it("学習者の記録が材料に入っていなければ、何も変えない", async () => {
    const a = fakeAdmin({ tables: { inquiry_projects: [], inquiry_project_members: [] } });
    expect(await invalidateWideScopeForStudent(a as never, "s1")).toBe(0);
    expect(a.log.length).toBe(0);
  });
});
