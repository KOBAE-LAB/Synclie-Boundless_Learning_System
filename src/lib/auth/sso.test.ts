import { describe, expect, it, vi } from "vitest";

// linkOrCreateSsoProfile() は createAdminClient() を直接呼ぶため、そのモジュールを差し替える。
let currentAdmin: unknown;
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => currentAdmin }));

const { linkOrCreateSsoProfile } = await import("./sso");

interface Row {
  id: string;
  role: string;
  approval_status: string;
  sso_provider?: string | null;
  organization_id?: string | null;
}

// profiles に対して linkOrCreateSsoProfile が実際に使うメソッド連鎖だけを再現する偽クライアント:
//  select().eq("sso_provider",..).eq("sso_subject",..).maybeSingle() … subject での検索
//  select().eq("email",..).maybeSingle()                          … メールでの検索
//  update(v).eq()                                                 … 統合
//  insert(v).select().single()                                    … 新規作成
function useFakeAdmin(db: { bySubject?: Row | null; byEmail?: Row | null; created?: Row | null }) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  currentAdmin = {
    from: () => ({
      select: () => {
        const columns: string[] = [];
        const chain = {
          eq: (column: string) => {
            columns.push(column);
            return chain;
          },
          maybeSingle: async () => ({
            data: columns[0] === "sso_provider" ? (db.bySubject ?? null) : (db.byEmail ?? null),
            error: null,
          }),
        };
        return chain;
      },
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(values);
          return { error: null };
        },
      }),
      insert: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          select: () => ({
            single: async () => ({
              data: db.created ?? { id: "new", role: "student", approval_status: "approved" },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  return { updates, inserts };
}

const base = {
  provider: "google",
  subject: "sub-1",
  email: "user@example.com",
  displayName: "User",
  tenantId: null,
};

describe("linkOrCreateSsoProfile", () => {
  it("承認待ちの教師は、SSOで同じsubjectで入ろうとしても拒否する", async () => {
    useFakeAdmin({ bySubject: { id: "t1", role: "teacher", approval_status: "pending" } });
    await expect(linkOrCreateSsoProfile({ ...base, emailVerified: true })).resolves.toBeNull();
  });

  it("承認済みなら、subjectで見つかったアカウントを返す", async () => {
    useFakeAdmin({ bySubject: { id: "s1", role: "student", approval_status: "approved" } });
    await expect(linkOrCreateSsoProfile({ ...base, emailVerified: true })).resolves.toEqual({
      id: "s1",
      role: "student",
    });
  });

  it("メールが確認済みなら既存アカウントに統合し、パスワードを無効化する(乗っ取り対策)", async () => {
    const { updates } = useFakeAdmin({
      byEmail: { id: "s2", role: "student", approval_status: "approved", sso_provider: null, organization_id: "o" },
    });
    await expect(linkOrCreateSsoProfile({ ...base, emailVerified: true })).resolves.toEqual({
      id: "s2",
      role: "student",
    });
    expect(updates[0]).toMatchObject({ sso_provider: "google", sso_subject: "sub-1", password_hash: null });
  });

  it("メールが確認済みでなければ、既存アカウントには統合しない(新規作成に進む)", async () => {
    const { updates, inserts } = useFakeAdmin({
      byEmail: { id: "s2", role: "student", approval_status: "approved", sso_provider: null, organization_id: "o" },
    });
    await linkOrCreateSsoProfile({ ...base, emailVerified: false });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("承認待ちの教師アカウントとは、メールが一致しても統合しない", async () => {
    const { updates } = useFakeAdmin({
      byEmail: { id: "t1", role: "teacher", approval_status: "pending", sso_provider: null, organization_id: null },
    });
    await expect(linkOrCreateSsoProfile({ ...base, emailVerified: true })).resolves.toBeNull();
    expect(updates).toHaveLength(0);
  });

  it("初めての人は学習者(student)として作る(教師にはならない)", async () => {
    const { inserts } = useFakeAdmin({});
    await expect(linkOrCreateSsoProfile({ ...base, emailVerified: true })).resolves.toEqual({
      id: "new",
      role: "student",
    });
    expect(inserts[0]).toMatchObject({ role: "student", sso_provider: "google", sso_subject: "sub-1" });
  });
});
