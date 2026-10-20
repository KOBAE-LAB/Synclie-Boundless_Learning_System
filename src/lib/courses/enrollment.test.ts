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

// 履修(series_enrollments)・授業回(courses)・プロファイル(profiles)を引く、この関数用の最小限の偽クライアント。
// series_enrollments には eq() の絞り込み条件も記録し、「承認済み(status='approved')だけを参加扱いにしている」
// ことを検証できるようにする。
function fakeAdmin(opts: {
  course?: { series_id: string; released: boolean } | null;
  enrollment?: boolean;
  testOwnerId?: string | null;
  filters?: Array<[string, unknown]>;
}): FakeAdmin {
  const filters = opts.filters ?? [];
  const chainFor = (table: string) => {
    const chain = {
      eq: (column: string, value: unknown) => {
        if (table === "series_enrollments") filters.push([column, value]);
        return chain;
      },
      maybeSingle: async () => {
        if (table === "courses") return { data: opts.course ?? null, error: null };
        if (table === "series_enrollments") return { data: opts.enrollment ? { student_id: "s" } : null, error: null };
        if (table === "profiles") return { data: { test_owner_id: opts.testOwnerId ?? null }, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  };
  return { from: (table: string) => ({ select: () => chainFor(table) }) } as unknown as FakeAdmin;
}

const released = { series_id: "series-1", released: true };

describe("isEnrolled", () => {
  it("シリーズを履修していて、回が公開済みならtrue", async () => {
    const admin = fakeAdmin({ course: released, enrollment: true });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(true);
  });

  it("承認済み(status='approved')の履修だけを参加扱いにする(申請中は入れない)", async () => {
    const filters: Array<[string, unknown]> = [];
    const admin = fakeAdmin({ course: released, enrollment: false, filters });
    await isEnrolled(admin, "course-1", "student-1");
    expect(filters).toContainEqual(["status", "approved"]);
    expect(filters).toContainEqual(["series_id", "series-1"]);
    expect(filters).toContainEqual(["student_id", "student-1"]);
  });

  it("履修が無ければfalse", async () => {
    const admin = fakeAdmin({ course: released, enrollment: false });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(false);
  });

  it("授業回が存在しなければfalse", async () => {
    const admin = fakeAdmin({ course: null, enrollment: true });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(false);
  });

  it("公開前の回は、履修していても学習者は開けない", async () => {
    const admin = fakeAdmin({ course: { series_id: "series-1", released: false }, enrollment: true });
    await expect(isEnrolled(admin, "course-1", "student-1")).resolves.toBe(false);
  });

  it("公開前の回でも、管理者のテスト学習者は確認のために開ける", async () => {
    const admin = fakeAdmin({ course: { series_id: "series-1", released: false }, enrollment: true, testOwnerId: "admin-1" });
    await expect(isEnrolled(admin, "course-1", "test-student")).resolves.toBe(true);
  });
});

describe("requireEnrollment", () => {
  it("参加登録済みなら何もしない(リダイレクトしない)", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ course: released, enrollment: true });
    await expect(requireEnrollment(admin, "course-1", "student-1")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("参加登録が無ければ/learnへリダイレクトする", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ course: released, enrollment: false });
    await expect(requireEnrollment(admin, "course-1", "student-1")).rejects.toThrow(
      "REDIRECT:/learn?not_enrolled=1",
    );
    expect(redirectMock).toHaveBeenCalledWith("/learn?not_enrolled=1");
  });
});
