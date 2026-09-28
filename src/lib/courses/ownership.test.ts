import { describe, expect, it } from "vitest";
import { assertOwnsCourse } from "./ownership";

// admin.from("courses").select(...).eq("id", courseId).maybeSingle() だけを叩く、
// このチェック用の最小限の偽クライアント(実際のSupabaseには繋がない)。
type FakeAdmin = Parameters<typeof assertOwnsCourse>[0];

function fakeAdmin(result: { data: unknown; error: unknown }): FakeAdmin {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as unknown as FakeAdmin;
}

describe("assertOwnsCourse", () => {
  it("所有者本人なら例外を投げない", async () => {
    const admin = fakeAdmin({ data: { id: "course-1", owner_teacher_id: "teacher-1" }, error: null });
    await expect(assertOwnsCourse(admin, "course-1", "teacher-1")).resolves.toBeUndefined();
  });

  it("別の教師の授業を操作しようとすると例外を投げる", async () => {
    const admin = fakeAdmin({ data: { id: "course-1", owner_teacher_id: "teacher-1" }, error: null });
    await expect(assertOwnsCourse(admin, "course-1", "teacher-2")).rejects.toThrow(
      "この授業を操作する権限がありません。",
    );
  });

  it("存在しない授業IDなら例外を投げる", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    await expect(assertOwnsCourse(admin, "missing-course", "teacher-1")).rejects.toThrow(
      "この授業を操作する権限がありません。",
    );
  });
});
