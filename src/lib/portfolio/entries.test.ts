import { describe, expect, it } from "vitest";
import { ownsSubmission, patchPortfolioEntry } from "./entries";

function fakeAdmin(opts: { submissionOwner?: string; existingEntryId?: string }) {
  const calls: { op: string; table: string; payload?: unknown }[] = [];
  const admin = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "submissions"
                ? (opts.submissionOwner ? { student_id: opts.submissionOwner } : null)
                : (opts.existingEntryId ? { id: opts.existingEntryId } : null),
            }),
          }),
        }),
        insert: async (payload: unknown) => { calls.push({ op: "insert", table, payload }); return { error: null }; },
        update: (payload: unknown) => ({ eq: async () => { calls.push({ op: "update", table, payload }); return { error: null }; } }),
      };
    },
  };
  return { admin: admin as never, calls };
}

describe("ownsSubmission", () => {
  it("本人の成果だけ true", async () => {
    expect(await ownsSubmission(fakeAdmin({ submissionOwner: "u1" }).admin, "u1", "s1")).toBe(true);
    expect(await ownsSubmission(fakeAdmin({ submissionOwner: "u2" }).admin, "u1", "s1")).toBe(false);
    expect(await ownsSubmission(fakeAdmin({}).admin, "u1", "s1")).toBe(false);
  });
});

describe("patchPortfolioEntry", () => {
  it("記録が無ければ作り、あれば更新する", async () => {
    const created = fakeAdmin({});
    await patchPortfolioEntry(created.admin, "u1", "s1", { shared: true });
    expect(created.calls[0]).toMatchObject({ op: "insert", table: "portfolio_entries", payload: { student_id: "u1", submission_id: "s1", shared: true } });

    const updated = fakeAdmin({ existingEntryId: "e1" });
    await patchPortfolioEntry(updated.admin, "u1", "s1", { shared: false });
    expect(updated.calls[0]).toMatchObject({ op: "update", payload: { shared: false } });
  });
});
