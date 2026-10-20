import { describe, expect, it } from "vitest";
import { copyCriteriaBetweenLessons, copyPersonasBetweenLessons, MAX_PERSONAS_PER_COURSE } from "./lesson-copy";

type FakeAdmin = Parameters<typeof copyPersonasBetweenLessons>[0];

// courses(2回分)・personas・evaluation_criteria だけを再現する偽クライアント。
// personas/evaluation_criteria は course_id で絞り込み、insert の中身を記録する。
function fakeAdmin(opts: {
  courses?: { id: string; series_id: string; lesson_no: number; title: string }[];
  personas?: Record<string, unknown>[];
  criteria?: Record<string, unknown>[];
}) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const admin = {
    from(table: string) {
      const source =
        table === "courses" ? (opts.courses ?? []) : table === "personas" ? (opts.personas ?? []) : (opts.criteria ?? []);
      let rows = [...source] as Record<string, unknown>[];
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: (_col: string, values: string[]) => {
          rows = rows.filter((r) => values.includes(r.id as string));
          return chain;
        },
        eq: (col: string, value: unknown) => {
          rows = rows.filter((r) => r[col] === value);
          return chain;
        },
        order: () => chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: rows }),
        insert: async (values: Record<string, unknown> | Record<string, unknown>[]) => {
          inserted[table] = [...(inserted[table] ?? []), ...(Array.isArray(values) ? values : [values])];
          return { error: null };
        },
      };
      return chain;
    },
    inserted,
  };
  return admin as unknown as FakeAdmin & { inserted: typeof inserted };
}

const courses = [
  { id: "c1", series_id: "s1", lesson_no: 1, title: "光" },
  { id: "c2", series_id: "s1", lesson_no: 2, title: "実験" },
  { id: "x1", series_id: "s2", lesson_no: 1, title: "別シリーズ" },
];
const persona = (name: string, courseId: string, extra: Record<string, unknown> = {}) => ({
  id: `p-${name}-${courseId}`, course_id: courseId, name, tier: "teacher_defined", status: "active", profile: {}, stance: {},
  behavior_rules: {}, shared_at: "2026-10-01", created_at: "2026-10-01", avatar_id: "a1", ...extra,
});

describe("copyPersonasBetweenLessons", () => {
  it("同じシリーズの別の回から、状態・アバターはそのまま、共有は引き継がずに複製する", async () => {
    const admin = fakeAdmin({ courses, personas: [persona("コウタ", "c1"), persona("ナナ", "c1", { status: "draft" })] });
    const result = await copyPersonasBetweenLessons(admin, "c1", "c2");
    expect(result).toEqual({ copied: 2, skipped: 0 });
    const rows = admin.inserted.personas;
    expect(rows.map((r) => r.course_id)).toEqual(["c2", "c2"]);
    expect(rows[0]).toMatchObject({ name: "コウタ", status: "active", avatar_id: "a1", shared_at: null });
    expect(rows[1]).toMatchObject({ status: "draft" });
    expect(String(rows[0].origin_note)).toContain("第1回");
    expect(rows[0]).not.toHaveProperty("id");
  });
  it("同じ名前がすでにあれば複製しない(何度押しても増えない)", async () => {
    const admin = fakeAdmin({ courses, personas: [persona("コウタ", "c1"), persona("コウタ", "c2")] });
    expect(await copyPersonasBetweenLessons(admin, "c1", "c2")).toEqual({ copied: 0, skipped: 1 });
    expect(admin.inserted.personas).toBeUndefined();
  });
  it("1授業回の上限を超えない", async () => {
    const many = Array.from({ length: MAX_PERSONAS_PER_COURSE }, (_, i) => persona(`n${i}`, "c1"));
    const admin = fakeAdmin({ courses, personas: [...many, persona("あふれる", "c1"), ...Array.from({ length: MAX_PERSONAS_PER_COURSE - 1 }, (_, i) => persona(`t${i}`, "c2"))] });
    const result = await copyPersonasBetweenLessons(admin, "c1", "c2");
    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(MAX_PERSONAS_PER_COURSE);
  });
  it("別のシリーズの授業回・同じ授業回からは複製できない", async () => {
    const admin = fakeAdmin({ courses, personas: [persona("コウタ", "x1")] });
    await expect(copyPersonasBetweenLessons(admin, "x1", "c2")).rejects.toThrow("同じシリーズ");
    await expect(copyPersonasBetweenLessons(admin, "c1", "c1")).rejects.toThrow("同じ授業回");
    expect(admin.inserted.personas).toBeUndefined();
  });
});

describe("copyCriteriaBetweenLessons", () => {
  const crit = (label: string, courseId: string, position: number) => ({ course_id: courseId, label, description: `${label}の説明`, position });
  it("同じ名前を除いて複製し、複製先の末尾の順番に並べる", async () => {
    const admin = fakeAdmin({ courses, criteria: [crit("根拠", "c1", 0), crit("多面性", "c1", 1), crit("根拠", "c2", 0)] });
    const result = await copyCriteriaBetweenLessons(admin, "c1", "c2");
    expect(result).toEqual({ copied: 1, skipped: 1 });
    expect(admin.inserted.evaluation_criteria[0]).toMatchObject({ course_id: "c2", label: "多面性", position: 1 });
  });
  it("別のシリーズからは複製できない", async () => {
    await expect(copyCriteriaBetweenLessons(fakeAdmin({ courses }), "x1", "c2")).rejects.toThrow("同じシリーズ");
  });
});
