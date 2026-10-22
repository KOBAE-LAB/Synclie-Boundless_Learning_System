import { describe, expect, it } from "vitest";
import { fakeAdmin } from "./fake-admin";
import { GroupRuleError } from "./groups";
import { setSoloTheme } from "./solo";

type Admin = Parameters<typeof setSoloTheme>[0];
const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;

const inquirySeries = { id: "s1", title: "探究 島の暮らし", kind: "inquiry", archived_at: null, fiscal_year: 2026, owner_teacher_id: "t1" };
const input = { seriesId: "s1", studentId: "u1", theme: "島の過疎を、どうすれば食い止められるか?" };

describe("setSoloTheme(個人の探究のテーマ)", () => {
  it("グループに入っていない学習者が、テーマを決められる。履歴も残る", async () => {
    const admin = fakeAdmin({ tables: { course_series: [inquirySeries], inquiry_project_members: [], inquiry_projects: [{ id: "p1", theme: null }] } });
    expect(await setSoloTheme(asAdmin(admin), input)).toEqual({ changed: true });
    expect(admin.log.some((l) => l.startsWith("update:inquiry_projects") && l.includes("島の過疎"))).toBe(true);
    expect(admin.log.some((l) => l.startsWith("insert:inquiry_theme_changes") && l.includes('"project_id":"p1"') && l.includes('"changed_by":"u1"'))).toBe(true);
  });
  it("テーマが変わっていなければ、何も書かない", async () => {
    const admin = fakeAdmin({ tables: { course_series: [inquirySeries], inquiry_project_members: [], inquiry_projects: [{ id: "p1", theme: input.theme }] } });
    expect(await setSoloTheme(asAdmin(admin), input)).toEqual({ changed: false });
    expect(admin.log.some((l) => l.startsWith("update:inquiry_projects") || l.startsWith("insert:inquiry_theme_changes"))).toBe(false);
  });
  it("グループに入っているときは、個人のテーマは決められない(グループのテーマを決める)", async () => {
    const admin = fakeAdmin({
      tables: {
        course_series: [inquirySeries],
        inquiry_project_members: [{ project_id: "g1" }],
        inquiry_projects: [{ id: "g1", title: "防災班", theme: null }],
      },
    });
    await expect(setSoloTheme(asAdmin(admin), input)).rejects.toBeInstanceOf(GroupRuleError);
    expect(admin.log.filter((l) => l.startsWith("update:") || l.startsWith("insert:"))).toEqual([]);
  });
  it("探究学習モードでない教科・科目・終了した教科・科目・空のテーマは拒否する", async () => {
    const standard = fakeAdmin({ tables: { course_series: [{ ...inquirySeries, kind: "standard" }] } });
    await expect(setSoloTheme(asAdmin(standard), input)).rejects.toBeInstanceOf(GroupRuleError);
    const archived = fakeAdmin({ tables: { course_series: [{ ...inquirySeries, archived_at: "2026-10-01" }] } });
    await expect(setSoloTheme(asAdmin(archived), input)).rejects.toBeInstanceOf(GroupRuleError);
    const open = fakeAdmin({ tables: { course_series: [inquirySeries] } });
    await expect(setSoloTheme(asAdmin(open), { ...input, theme: "   " })).rejects.toBeInstanceOf(GroupRuleError);
  });
});
