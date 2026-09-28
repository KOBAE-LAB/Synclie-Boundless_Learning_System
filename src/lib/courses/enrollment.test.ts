import { describe, expect, it, vi } from "vitest";

// requireEnrollment() は next/navigation の redirect() を呼ぶ。実際のNext.jsランタイム外
// (このテスト)では特殊な例外を投げられないため、代わりに投げる例外を偽装して検証する。
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { redirect } = await import("next/navigation");
const { isEnrolled, requireEnrollment } = await import("./enrollment");
const redirectMock = vi.mocked(redirect);

type FakeAdmin = Parameters<typeof isEnrolled>[0];

// admin.from("course_enrollments").select(...).eq("course_id", ...).eq("student_id", ...).maybeSingle()
// だけを叩く、この2つの関数用の最小限の偽クライアント。
function fakeAdmin(result: { data: unknown; error: unknown }): FakeAdmin {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
      }),
    }),
  } as unknown as FakeAdmin;
}

describe("isEnrolled", () => {
  it("参加登録があればtrue", async () => {
    const admin = fakeAdmin({ data: { id: "enrollment-1" }, error: null });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(true);
  });

  it("参加登録が無ければfalse", async () => {
    const admin = fakeAdmin({ data: null, error: null });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(false);
  });
});

describe("requireEnrollment", () => {
  it("参加登録済みなら何もしない(リダイレクトしない)", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: { id: "enrollment-1" }, error: null });
    await expect(requireEnrollment(admin, "course-1", "student-1")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("参加登録が無ければ/learnへリダイレクトする", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: null, error: null });
    await expect(requireEnrollment(admin, "course-1", "student-1")).rejects.toThrow(
      "REDIRECT:/learn?not_enrolled=1",
    );
    expect(redirectMock).toHaveBeenCalledWith("/learn?not_enrolled=1");
  });
});
