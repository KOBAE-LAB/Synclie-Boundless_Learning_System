import { describe, expect, it } from "vitest";
import { deleteSeriesIfEmpty, seriesHasLearnerRecords } from "./series-admin";
import { fiscalYearOfDate, isLessonArchived, seriesLabel } from "./series";

type FakeAdmin = Parameters<typeof seriesHasLearnerRecords>[0];

// courses / learning_sessions / submissions / course_steps / step_progress / course_series だけを再現する偽クライアント。
function fakeAdmin(opts: { lessons?: string[]; sessions?: number; submissions?: number; stepIds?: string[]; progress?: number; archivedAt?: string | null }) {
  const calls: string[] = [];
  const admin = {
    storage: { from: () => ({ remove: async (paths: string[]) => { calls.push(`remove:${paths.join(",")}`); } }) },
    from(table: string) {
      return {
        select: (_cols?: string, options?: { head?: boolean }) => {
          void options;
          const result = (data: unknown, count = 0) => ({ data, count });
          const chain: Record<string, unknown> = {
            eq: () => chain,
            in: async () => {
              if (table === "learning_sessions") return result(null, opts.sessions ?? 0);
              if (table === "submissions") return result(null, opts.submissions ?? 0);
              if (table === "course_steps") return result((opts.stepIds ?? []).map((id) => ({ id, video_path: `v/${id}` })));
              if (table === "step_progress") return result(null, opts.progress ?? 0);
              if (table === "course_materials") return result([{ storage_path: "m/file.pdf" }]);
              return result([]);
            },
            maybeSingle: async () =>
              table === "courses" ? { data: { series_id: "s1" } } : { data: { archived_at: opts.archivedAt ?? null } },
            then: undefined,
          };
          // courses.select(...).eq("series_id", ...) は配列を返す
          if (table === "courses") {
            chain.eq = () => ({
              then: (resolve: (v: unknown) => void) => resolve({ data: (opts.lessons ?? []).map((id) => ({ id })) }),
              maybeSingle: async () => ({ data: { series_id: "s1" } }),
            });
          }
          return chain;
        },
        delete: () => ({ eq: async () => { calls.push(`delete:${table}`); return { error: null }; } }),
      };
    },
    calls,
  };
  return admin as unknown as FakeAdmin & { calls: string[] };
}

describe("seriesHasLearnerRecords", () => {
  it("授業回が無ければ記録なし", async () => {
    expect(await seriesHasLearnerRecords(fakeAdmin({ lessons: [] }), "s1")).toBe(false);
  });
  it("対話・提出・インプットの進みのどれかがあれば記録あり", async () => {
    expect(await seriesHasLearnerRecords(fakeAdmin({ lessons: ["c1"], sessions: 1 }), "s1")).toBe(true);
    expect(await seriesHasLearnerRecords(fakeAdmin({ lessons: ["c1"], submissions: 2 }), "s1")).toBe(true);
    expect(await seriesHasLearnerRecords(fakeAdmin({ lessons: ["c1"], stepIds: ["st1"], progress: 1 }), "s1")).toBe(true);
  });
  it("どれも無ければ記録なし", async () => {
    expect(await seriesHasLearnerRecords(fakeAdmin({ lessons: ["c1"], stepIds: ["st1"] }), "s1")).toBe(false);
  });
});

describe("deleteSeriesIfEmpty", () => {
  it("学習者の記録があれば削除せず、アーカイブを促す", async () => {
    const admin = fakeAdmin({ lessons: ["c1"], submissions: 1 });
    await expect(deleteSeriesIfEmpty(admin, "s1")).rejects.toThrow("アーカイブ");
    expect(admin.calls).not.toContain("delete:course_series");
  });
  it("記録が無ければ、シリーズを削除し、Storageのファイルも消す", async () => {
    const admin = fakeAdmin({ lessons: ["c1"] });
    await deleteSeriesIfEmpty(admin, "s1");
    expect(admin.calls).toContain("delete:course_series");
    expect(admin.calls.some((c) => c.startsWith("remove:") && c.includes("m/file.pdf"))).toBe(true);
  });
});

describe("isLessonArchived", () => {
  it("シリーズのarchived_atがあればtrue", async () => {
    expect(await isLessonArchived(fakeAdmin({ archivedAt: "2027-03-31T00:00:00Z" }), "c1")).toBe(true);
    expect(await isLessonArchived(fakeAdmin({ archivedAt: null }), "c1")).toBe(false);
  });
});

describe("seriesLabel / fiscalYearOfDate", () => {
  it("全回数があれば「(全N回)」を付ける", () => {
    expect(seriesLabel("理科", 8)).toBe("理科(全8回)");
    expect(seriesLabel("理科", null)).toBe("理科");
  });
  it("年度は4月始まり(日本時間)", () => {
    expect(fiscalYearOfDate(new Date("2026-04-01T00:00:00+09:00"))).toBe(2026);
    expect(fiscalYearOfDate(new Date("2027-03-31T23:00:00+09:00"))).toBe(2026);
  });
});
