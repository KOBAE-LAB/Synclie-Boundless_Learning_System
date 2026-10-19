import { beforeEach, describe, expect, it, vi } from "vitest";

// requireAdmin() は next/navigation の redirect()・Auth.jsの auth()・Supabaseの管理者クライアントを
// 使う。いずれも実物には繋がず、テスト内で偽装する(consent.test.ts と同じ方針)。
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "synclie_view_as" && cookieValue ? { value: cookieValue } : undefined) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));

const { auth } = await import("@/auth");
const { createAdminClient } = await import("@/lib/supabase/server");
const { isAdmin, requireAdmin, requireRole, getEffectiveStudent, isViewingAsStudent } = await import("./session");
const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const createAdminClientMock = vi.mocked(createAdminClient);

type FakeAdmin = ReturnType<typeof createAdminClient>;

// profiles に対する問い合わせだけを再現する偽クライアント:
//  select("is_admin").eq("id",..).maybeSingle()               … 管理者かどうか
//  select("id, display_name").eq("test_owner_id",..).maybeSingle() … その管理者のテスト学習者
function fakeAdmin(row: { is_admin: boolean } | null, testStudent: { id: string; display_name: string } | null = null): FakeAdmin {
  return {
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () => ({ data: columns === "is_admin" ? row : testStudent, error: null }),
        }),
      }),
    }),
  } as unknown as FakeAdmin;
}

function loginAs(role: "teacher" | "student") {
  authMock.mockResolvedValue({ user: { id: "user-1", role, name: "n", email: "e@example.com" } });
}

beforeEach(() => {
  cookieValue = undefined;
  authMock.mockReset();
  createAdminClientMock.mockReset();
});

describe("isAdmin", () => {
  it("is_admin が立っていればtrue", async () => {
    await expect(isAdmin(fakeAdmin({ is_admin: true }), "user-1")).resolves.toBe(true);
  });
  it("立っていない/プロフィールが無ければfalse", async () => {
    await expect(isAdmin(fakeAdmin({ is_admin: false }), "user-1")).resolves.toBe(false);
    await expect(isAdmin(fakeAdmin(null), "user-1")).resolves.toBe(false);
  });
});

describe("requireAdmin", () => {
  it("管理者の教師なら通す", async () => {
    loginAs("teacher");
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }));
    await expect(requireAdmin()).resolves.toMatchObject({ user: { id: "user-1" } });
  });
  it("管理者でない教師は/coursesへ戻す(教師の承認はできない)", async () => {
    loginAs("teacher");
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: false }));
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/courses");
  });
  it("学習者は管理者の画面に入れない", async () => {
    loginAs("student");
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }));
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
  });
  it("未ログインならログイン画面へ", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("requireRole", () => {
  it("ロールが違えばログイン画面へ戻す", async () => {
    loginAs("student");
    await expect(requireRole("teacher")).rejects.toThrow("REDIRECT:/login");
  });
});

// 管理者の「学習者として表示」(動作確認用)。他人として画面を見られる機能なので、
// 管理者以外には絶対に効かないこと、Cookieだけでは効かないことを確かめる。
const TEST_STUDENT = { id: "test-student-1", display_name: "テスト学習者" };

describe("管理者の「学習者として表示」", () => {
  it("管理者+切り替えのCookieがあれば、その管理者のテスト学習者として学習者の画面に入れる", async () => {
    loginAs("teacher");
    cookieValue = "student";
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }, TEST_STUDENT));

    await expect(requireRole("student")).resolves.toMatchObject({ user: { id: "test-student-1", role: "student" } });
    await expect(getEffectiveStudent()).resolves.toMatchObject({ id: "test-student-1" });
    await expect(isViewingAsStudent()).resolves.toBe(true);
  });

  it("管理者でない教師は、Cookieを偽装しても学習者の画面に入れない", async () => {
    loginAs("teacher");
    cookieValue = "student";
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: false }, TEST_STUDENT));

    await expect(requireRole("student")).rejects.toThrow("REDIRECT:/login");
    await expect(getEffectiveStudent()).resolves.toBeNull();
    await expect(isViewingAsStudent()).resolves.toBe(false);
  });

  it("管理者でも、Cookie(切り替えの印)が無ければ、教師のまま(学習者の画面には入れない)", async () => {
    loginAs("teacher");
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }, TEST_STUDENT));

    await expect(requireRole("student")).rejects.toThrow("REDIRECT:/login");
    await expect(getEffectiveStudent()).resolves.toBeNull();
  });

  it("テスト学習者がまだ無ければ、切り替えは効かない", async () => {
    loginAs("teacher");
    cookieValue = "student";
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }, null));

    await expect(getEffectiveStudent()).resolves.toBeNull();
  });

  it("学習者本人は、Cookieがあっても自分自身のまま(他人にはなれない)", async () => {
    loginAs("student");
    cookieValue = "student";
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }, TEST_STUDENT));

    await expect(getEffectiveStudent()).resolves.toMatchObject({ id: "user-1", role: "student" });
    await expect(isViewingAsStudent()).resolves.toBe(false);
  });

  it("切り替え中でも、教師の画面(requireRole teacher)は管理者本人のまま使える", async () => {
    loginAs("teacher");
    cookieValue = "student";
    createAdminClientMock.mockReturnValue(fakeAdmin({ is_admin: true }, TEST_STUDENT));

    await expect(requireRole("teacher")).resolves.toMatchObject({ user: { id: "user-1", role: "teacher" } });
  });

  it("未ログインなら何も返さない", async () => {
    authMock.mockResolvedValue(null);
    cookieValue = "student";
    await expect(getEffectiveStudent()).resolves.toBeNull();
  });
});
