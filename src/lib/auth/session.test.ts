import { beforeEach, describe, expect, it, vi } from "vitest";

// requireAdmin() は next/navigation の redirect()・Auth.jsの auth()・Supabaseの管理者クライアントを
// 使う。いずれも実物には繋がず、テスト内で偽装する(consent.test.ts と同じ方針)。
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));

const { auth } = await import("@/auth");
const { createAdminClient } = await import("@/lib/supabase/server");
const { isAdmin, requireAdmin, requireRole } = await import("./session");
const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const createAdminClientMock = vi.mocked(createAdminClient);

type FakeAdmin = ReturnType<typeof createAdminClient>;

// admin.from("profiles").select("is_admin").eq("id", ...).maybeSingle() だけを叩く最小限の偽クライアント。
function fakeAdmin(row: { is_admin: boolean } | null): FakeAdmin {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
    }),
  } as unknown as FakeAdmin;
}

function loginAs(role: "teacher" | "student") {
  authMock.mockResolvedValue({ user: { id: "user-1", role, name: "n", email: "e@example.com" } });
}

beforeEach(() => {
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
