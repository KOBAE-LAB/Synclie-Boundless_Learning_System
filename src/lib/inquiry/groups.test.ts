import { describe, expect, it } from "vitest";
import { fakeAdmin } from "./fake-admin";
import {
  createGroup,
  deleteEmptyGroup,
  GroupRuleError,
  joinByCode,
  loadGroupInSeries,
  normalizeGroupCode,
  setGroupTheme,
} from "./groups";

type Admin = Parameters<typeof createGroup>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

const inquirySeries = { id: "s1", title: "探究 地域の防災", kind: "inquiry", archived_at: null, fiscal_year: 2026, owner_teacher_id: "t1" };
const group = { id: "g1", series_id: "s1", kind: "group", title: "防災班", theme: "避難所", join_code: "ABC234" };

describe("joinByCode(誰がグループに入れるか)", () => {
  it("承認済みの履修者は、コードで入れる", async () => {
    const admin = fakeAdmin({
      tables: {
        inquiry_projects: [group],
        course_series: [inquirySeries],
        series_enrollments: [{ student_id: "u1" }],
        inquiry_project_members: [],
      },
    });
    expect(await joinByCode(asAdmin(admin), { code: "abc-234", studentId: "u1" })).toEqual({
      projectId: "g1",
      seriesId: "s1",
      title: "防災班",
    });
    expect(admin.log.some((l) => l.startsWith("upsert:inquiry_project_members") && l.includes('"left_at":null'))).toBe(true);
  });
  it("履修していない(承認されていない)学習者は入れない", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_projects: [group], course_series: [inquirySeries], series_enrollments: [] },
    });
    await expect(joinByCode(asAdmin(admin), { code: "ABC234", studentId: "u9" })).rejects.toBeInstanceOf(GroupRuleError);
    expect(admin.log.some((l) => l.startsWith("upsert:"))).toBe(false);
  });
  it("終了(アーカイブ)した教科・科目のグループには入れない", async () => {
    const admin = fakeAdmin({
      tables: {
        inquiry_projects: [group],
        course_series: [{ ...inquirySeries, archived_at: "2027-03-31" }],
        series_enrollments: [{ student_id: "u1" }],
      },
    });
    await expect(joinByCode(asAdmin(admin), { code: "ABC234", studentId: "u1" })).rejects.toThrow("終了");
  });
  it("個人プロジェクトはコードで入れない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ ...group, kind: "solo" }] } });
    await expect(joinByCode(asAdmin(admin), { code: "ABC234", studentId: "u1" })).rejects.toThrow("見つかりません");
  });
  it("別のグループに入ると、同じ教科・科目の前のグループからは抜ける", async () => {
    const admin = fakeAdmin({
      tables: {
        inquiry_projects: [group, { id: "g0", series_id: "s1", kind: "group" }],
        course_series: [inquirySeries],
        series_enrollments: [{ student_id: "u1" }],
        inquiry_project_members: [{ project_id: "g0" }],
      },
    });
    // 偽クライアントは絞り込みを無視して先頭の行を返すので、g1 として読まれる。
    await joinByCode(asAdmin(admin), { code: "ABC234", studentId: "u1" });
    expect(admin.log.some((l) => l.startsWith("update:inquiry_project_members") && l.includes("left_at"))).toBe(true);
  });
});

describe("setGroupTheme(テーマはグループが決め、履歴を残す)", () => {
  it("メンバーが変えると、テーマを更新して履歴を残す", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_projects: [group], course_series: [inquirySeries], inquiry_project_members: [{ student_id: "u1" }] },
    });
    expect(await setGroupTheme(asAdmin(admin), { projectId: "g1", studentId: "u1", theme: "  避難所の  バリアフリー " })).toEqual({
      changed: true,
    });
    expect(admin.log).toContain('update:inquiry_projects:{"theme":"避難所の バリアフリー"}');
    expect(admin.log.find((l) => l.startsWith("insert:inquiry_theme_changes"))).toContain('"changed_by":"u1"');
  });
  it("メンバーでなければ変えられない", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_projects: [group], course_series: [inquirySeries], inquiry_project_members: [] },
    });
    await expect(setGroupTheme(asAdmin(admin), { projectId: "g1", studentId: "u9", theme: "x" })).rejects.toBeInstanceOf(GroupRuleError);
    expect(admin.log).toEqual([]);
  });
  it("同じテーマなら履歴を増やさない", async () => {
    const admin = fakeAdmin({
      tables: { inquiry_projects: [group], course_series: [inquirySeries], inquiry_project_members: [{ student_id: "u1" }] },
    });
    expect(await setGroupTheme(asAdmin(admin), { projectId: "g1", studentId: "u1", theme: "避難所" })).toEqual({ changed: false });
    expect(admin.log).toEqual([]);
  });
});

describe("教師の操作の境界", () => {
  it("別の教科・科目のグループは触れない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [{ ...group, series_id: "other" }] } });
    await expect(loadGroupInSeries(asAdmin(admin), "g1", "s1")).rejects.toBeInstanceOf(GroupRuleError);
  });
  it("通常の教科・科目にはグループを作れない", async () => {
    const admin = fakeAdmin({ tables: { course_series: [{ ...inquirySeries, kind: "standard" }] } });
    await expect(createGroup(asAdmin(admin), { seriesId: "s1", teacherId: "t1", title: "A班" })).rejects.toThrow("探究");
  });
  it("議論の記録があるグループは消さない", async () => {
    const admin = fakeAdmin({ tables: { inquiry_projects: [group], learning_sessions: [{ id: "x" }] } });
    await expect(deleteEmptyGroup(asAdmin(admin), { seriesId: "s1", projectId: "g1" })).rejects.toThrow("記録");
    expect(admin.log.some((l) => l.startsWith("delete:"))).toBe(false);
  });
});

describe("normalizeGroupCode", () => {
  it("大文字小文字・空白・ハイフンを無視する", () => {
    expect(normalizeGroupCode(" ab c-23 4 ")).toBe("ABC234");
  });
});
