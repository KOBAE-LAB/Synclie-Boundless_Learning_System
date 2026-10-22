import { describe, expect, it } from "vitest";
import { fakeAdmin } from "@/lib/inquiry/fake-admin";
import { memberAlias, resolveSessionScope, scopeSessionQuery, type SessionScope } from "./session-scope";

type Admin = Parameters<typeof resolveSessionScope>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

describe("resolveSessionScope(誰の議論を見るか・書くかの境界)", () => {
  it("通常の教科・科目は、学習者本人の議論", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ series_id: "s1" }], course_series: [{ kind: "standard" }] } });
    expect(await resolveSessionScope(asAdmin(admin), "c1", "u1")).toEqual({ kind: "solo", studentId: "u1" });
  });
  it("探究学習モードでグループに入っていなければ、個人の探究(本人の議論)。テーマは本人の個人プロジェクトから", async () => {
    const admin = fakeAdmin({
      tables: {
        courses: [{ series_id: "s1" }],
        course_series: [{ kind: "inquiry" }],
        inquiry_project_members: [],
        inquiry_projects: [{ id: "p1", theme: "島の過疎" }],
      },
    });
    expect(await resolveSessionScope(asAdmin(admin), "c1", "u1")).toEqual({ kind: "solo", studentId: "u1", inquiry: true, theme: "島の過疎" });
  });
  it("個人の探究で、テーマをまだ決めていなければ null", async () => {
    const admin = fakeAdmin({
      tables: { courses: [{ series_id: "s1" }], course_series: [{ kind: "inquiry" }], inquiry_project_members: [], inquiry_projects: [] },
    });
    expect(await resolveSessionScope(asAdmin(admin), "c1", "u1")).toEqual({ kind: "solo", studentId: "u1", inquiry: true, theme: null });
  });
  it("探究の教科・科目でグループに入っていれば、グループの共有の議論", async () => {
    const admin = fakeAdmin({
      tables: {
        courses: [{ series_id: "s1" }],
        course_series: [{ kind: "inquiry" }],
        inquiry_project_members: [{ project_id: "g1", student_id: "u1", joined_at: "2026-10-01" }],
        inquiry_projects: [{ id: "g1", title: "防災班", theme: "避難所" }],
      },
    });
    expect(await resolveSessionScope(asAdmin(admin), "c1", "u1")).toEqual({
      kind: "group",
      projectId: "g1",
      groupTitle: "防災班",
      theme: "避難所",
      memberIds: ["u1"],
    });
  });
});

describe("scopeSessionQuery", () => {
  const recorder = () => {
    const calls: string[] = [];
    const q = {
      eq: (c: string, v: string) => (calls.push(`eq:${c}=${v}`), q),
      is: (c: string, v: null) => (calls.push(`is:${c}=${v}`), q),
      calls,
    };
    return q;
  };
  it("グループの議論は、グループで、かつ学習者個人の議論ではないものに絞る", () => {
    const q = recorder();
    scopeSessionQuery(q, { kind: "group", projectId: "g1", groupTitle: "", theme: null, memberIds: [] } as SessionScope);
    expect(q.calls).toEqual(["eq:project_id=g1", "is:student_id=null"]);
  });
  it("個人の探究・通常の議論は、学習者本人の議論に絞る", () => {
    const q = recorder();
    scopeSessionQuery(q, { kind: "solo", studentId: "u1", inquiry: true, theme: null });
    expect(q.calls).toEqual(["eq:student_id=u1"]);
  });

});

describe("memberAlias(AIには氏名を送らない)", () => {
  it("参加した順に メンバーA, B…", () => {
    expect(memberAlias(["u1", "u2"], "u2")).toBe("メンバーB");
    expect(memberAlias(["u1", "u2"], "u9")).toBe("メンバー");
  });
});
