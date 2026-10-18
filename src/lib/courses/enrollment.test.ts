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

// admin.from("course_enrollments").select(...).eq(...).eq(...).eq(...).maybeSingle() だけを叩く、
// この2つの関数用の最小限の偽クライアント。eq() に渡された絞り込み条件も記録して、
// 「承認済み(status='approved')だけを参加扱いにしている」ことを検証できるようにする。
function fakeAdmin(
  result: { data: unknown; error: unknown },
  filters: Array<[string, unknown]> = [],
): FakeAdmin {
  const chain = {
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    maybeSingle: async () => result,
  };
  return { from: () => ({ select: () => chain }) } as unknown as FakeAdmin;
}

describe("isEnrolled", () => {
  it("参加登録があればtrue", async () => {
    const admin = fakeAdmin({ data: { id: "enrollment-1" }, error: null });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(true);
  });

  it("承認済み(status='approved')の登録だけを参加扱いにする(申請中は入れない)", async () => {
    const filters: Array<[string, unknown]> = [];
    const admin = fakeAdmin({ data: null, error: null }, filters);
    await isEnrolled(admin, "course-1", "student-1");
    expect(filters).toContainEqual(["status", "approved"]);
    expect(filters).toContainEqual(["course_id", "course-1"]);
    expect(filters).toContainEqual(["student_id", "student-1"]);
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
