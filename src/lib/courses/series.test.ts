import { describe, expect, it } from "vitest";
import { assertOwnsSeries, lessonFullName, lessonName, loadLessonLabels } from "./series";

type FakeAdmin = Parameters<typeof assertOwnsSeries>[0];

describe("assertOwnsSeries", () => {
  const admin = (row: { id: string; owner_teacher_id: string } | null, error: unknown = null) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) }) as unknown as FakeAdmin;

  it("担当教師なら通る", async () => {
    await expect(assertOwnsSeries(admin({ id: "s1", owner_teacher_id: "t1" }), "s1", "t1")).resolves.toBeUndefined();
  });
  it("他の教師・存在しない教科・科目・エラーは拒否する", async () => {
    await expect(assertOwnsSeries(admin({ id: "s1", owner_teacher_id: "t2" }), "s1", "t1")).rejects.toThrow("権限");
    await expect(assertOwnsSeries(admin(null), "s1", "t1")).rejects.toThrow("権限");
    await expect(assertOwnsSeries(admin(null, { message: "x" }), "s1", "t1")).rejects.toThrow("権限");
  });
});

describe("lessonName / lessonFullName", () => {
  it("「第N回 名前」と、教科・科目名つきの表示名", () => {
    expect(lessonName(3, "光の強さ")).toBe("第3回 光の強さ");
    expect(lessonFullName("理科1年", 3, "光の強さ")).toBe("理科1年 第3回 光の強さ");
  });
});

describe("loadLessonLabels", () => {
  it("授業回のidから、教科・科目名つきの表示名を引く", async () => {
    const admin = {
      from: (table: string) => ({
        select: () => ({
          in: async () =>
            table === "courses"
              ? { data: [{ id: "c1", title: "光", lesson_no: 2, series_id: "s1" }] }
              : { data: [{ id: "s1", title: "理科" }] },
        }),
      }),
    } as unknown as FakeAdmin;
    expect((await loadLessonLabels(admin, ["c1"])).get("c1")).toBe("理科 第2回 光");
    expect((await loadLessonLabels(admin, [])).size).toBe(0);
  });
});
