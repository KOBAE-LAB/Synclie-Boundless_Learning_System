import { describe, expect, it } from "vitest";
import { ensureTestStudentEnrolled, getOrCreateTestStudent, TEST_STUDENT_NAME } from "./view-as";

type FakeAdmin = Parameters<typeof getOrCreateTestStudent>[0];

// profiles(select/insert)と course_enrollments(upsert)だけを再現する偽クライアント。
function fakeAdmin(opts: { existing?: { id: string } | null; insertError?: { message: string } | null }) {
  const inserts: Array<Record<string, unknown>> = [];
  const upserts: Array<Record<string, unknown>> = [];
  let existing = opts.existing ?? null;
  const admin = {
    from: (table: string) => {
      if (table === "course_enrollments") {
        return {
          upsert: async (values: Record<string, unknown>) => {
            upserts.push(values);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
        insert: (values: Record<string, unknown>) => {
          inserts.push(values);
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : { data: { id: values.id as string }, error: null },
            }),
          };
        },
      };
    },
  } as unknown as FakeAdmin;
  return { admin, inserts, upserts, setExisting: (row: { id: string }) => (existing = row) };
}

describe("getOrCreateTestStudent", () => {
  it("既にあればそれを使い、新しく作らない", async () => {
    const { admin, inserts } = fakeAdmin({ existing: { id: "t1" } });
    await expect(getOrCreateTestStudent(admin, "admin-1")).resolves.toBe("t1");
    expect(inserts).toHaveLength(0);
  });

  it("無ければ、学習者・パスワード無し・管理者に紐づけて作る(直接ログインできない)", async () => {
    const { admin, inserts } = fakeAdmin({});
    await getOrCreateTestStudent(admin, "admin-1");
    expect(inserts[0]).toMatchObject({ role: "student", display_name: TEST_STUDENT_NAME, test_owner_id: "admin-1" });
    expect(inserts[0]).not.toHaveProperty("password_hash");
    expect(inserts[0]).not.toHaveProperty("email");
  });

  it("同時に作られて失敗した場合は、先にできた方を使う", async () => {
    const f = fakeAdmin({ insertError: { message: "duplicate key" } });
    // 最初の検索では無く、挿入が失敗した後の再検索で見つかる、という状況を再現する
    let calls = 0;
    const original = (f.admin as unknown as { from: (t: string) => { select: () => unknown } }).from;
    (f.admin as unknown as { from: unknown }).from = (table: string) => {
      const base = original(table) as { select: () => unknown };
      if (table !== "profiles") return base;
      return {
        ...base,
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: ++calls >= 2 ? { id: "winner" } : null, error: null }) }),
        }),
      };
    };
    await expect(getOrCreateTestStudent(f.admin, "admin-1")).resolves.toBe("winner");
  });

  it("作成に失敗し、再検索でも見つからなければエラー", async () => {
    const { admin } = fakeAdmin({ insertError: { message: "boom" } });
    await expect(getOrCreateTestStudent(admin, "admin-1")).rejects.toThrow("テスト学習者の作成に失敗しました");
  });
});

describe("ensureTestStudentEnrolled", () => {
  it("テスト学習者を、その授業の『承認済み』の受講者にする", async () => {
    const { admin, upserts } = fakeAdmin({ existing: { id: "t1" } });
    await expect(ensureTestStudentEnrolled(admin, "admin-1", "course-1")).resolves.toBe("t1");
    expect(upserts[0]).toEqual({ course_id: "course-1", student_id: "t1", status: "approved" });
  });
});
