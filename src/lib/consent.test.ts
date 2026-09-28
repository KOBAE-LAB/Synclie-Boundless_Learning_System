import { describe, expect, it, vi } from "vitest";

// requireConsent() は next/navigation の redirect() を呼ぶ。実際のNext.jsランタイム外
// (このテスト)では特殊な例外を投げられないため、代わりに投げる例外を偽装して検証する。
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { redirect } = await import("next/navigation");
const { requireConsent } = await import("./consent");
const redirectMock = vi.mocked(redirect);

type FakeAdmin = Parameters<typeof requireConsent>[0];

// admin.from("consent_records").select(...).eq("student_id", ...).maybeSingle() だけを叩く、
// このチェック用の最小限の偽クライアント。
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

describe("requireConsent", () => {
  it("同意済み(撤回されていない)なら何もしない", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: { withdrawn_at: null }, error: null });
    await expect(requireConsent(admin, "student-1")).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("同意記録が無ければ/consentへリダイレクトする", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: null, error: null });
    await expect(requireConsent(admin, "student-1")).rejects.toThrow("REDIRECT:/consent");
  });

  it("同意を撤回済みなら/consentへリダイレクトする", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: { withdrawn_at: "2026-01-01T00:00:00Z" }, error: null });
    await expect(requireConsent(admin, "student-1")).rejects.toThrow("REDIRECT:/consent");
  });
});
