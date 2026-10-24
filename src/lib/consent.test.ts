import { describe, expect, it, vi } from "vitest";

// requireConsent() は next/navigation の redirect() を呼ぶ。実際のNext.jsランタイム外
// (このテスト)では特殊な例外を投げられないため、代わりに投げる例外を偽装して検証する。
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const { redirect } = await import("next/navigation");
const { requireConsent, isConsentCurrent, needsReconsent, CONSENT_TEXT_UPDATED_AT } = await import("./consent");
const redirectMock = vi.mocked(redirect);

type FakeAdmin = Parameters<typeof requireConsent>[0];

// admin.from("consent_records").select(...).eq("student_id", ...).eq("scope", "data_use").maybeSingle() だけを叩く、
// このチェック用の最小限の偽クライアント。
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

describe("requireConsent", () => {
  it("同意済み(撤回されていない)なら何もしない", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: { granted_at: "2026-10-22T00:00:00Z", withdrawn_at: null }, error: null });
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

describe("同意の説明文が更新されたときの再同意", () => {
  const after = "2026-10-22T00:00:00Z";
  const before = "2026-10-01T00:00:00Z";

  it("更新後に同意したものだけが有効", () => {
    expect(isConsentCurrent({ granted_at: after, withdrawn_at: null })).toBe(true);
    expect(isConsentCurrent({ granted_at: CONSENT_TEXT_UPDATED_AT, withdrawn_at: null })).toBe(true);
  });
  it("更新前の同意・撤回済み・記録なしは有効ではない", () => {
    expect(isConsentCurrent({ granted_at: before, withdrawn_at: null })).toBe(false);
    expect(isConsentCurrent({ granted_at: after, withdrawn_at: "2026-10-23T00:00:00Z" })).toBe(false);
    expect(isConsentCurrent(null)).toBe(false);
  });
  it("更新前に同意して、撤回していない学習者だけが「再同意が必要」", () => {
    expect(needsReconsent({ granted_at: before, withdrawn_at: null })).toBe(true);
    expect(needsReconsent({ granted_at: after, withdrawn_at: null })).toBe(false);
    expect(needsReconsent({ granted_at: before, withdrawn_at: "2026-10-23T00:00:00Z" })).toBe(false);
    expect(needsReconsent(null)).toBe(false);
  });
  it("更新前に同意した学習者は、授業の画面に入る前に、同意画面へ戻される", async () => {
    redirectMock.mockClear();
    const admin = fakeAdmin({ data: { granted_at: before, withdrawn_at: null }, error: null });
    await expect(requireConsent(admin, "student-1")).rejects.toThrow("REDIRECT:/consent");
  });
});
