import { createAdminClient } from "@/lib/supabase/server";
import { lessonName } from "@/lib/courses/series";

type AdminClient = ReturnType<typeof createAdminClient>;

export const MAX_PERSONAS_PER_COURSE = 10;

export interface CopyResult {
  copied: number;
  /** すでに同じ名前があった・上限を超えたため、複製しなかった数 */
  skipped: number;
}

/** 同じ教科・科目の授業回どうしだけ、複製できる(他の教科・科目の授業回からは複製しない)。 */
async function loadSameSeriesPair(admin: AdminClient, fromCourseId: string, toCourseId: string) {
  if (fromCourseId === toCourseId) throw new Error("複製元と複製先が同じ授業回です。");
  const { data } = await admin.from("courses").select("id, series_id, lesson_no, title").in("id", [fromCourseId, toCourseId]);
  const from = (data ?? []).find((c) => c.id === fromCourseId);
  const to = (data ?? []).find((c) => c.id === toCourseId);
  if (!from || !to) throw new Error("授業回が見つかりません。");
  if (from.series_id !== to.series_id) throw new Error("同じ教科・科目の授業回からだけ複製できます。");
  return { from, to };
}

/**
 * 擬似メンバーを、同じ教科・科目の別の授業回から複製する(状態・アバターもそのまま。共有ライブラリへの公開は引き継がない)。
 * 同じ名前がすでにあれば複製しない(何度押しても増えない)。1授業回の上限は10体まで。
 */
export async function copyPersonasBetweenLessons(admin: AdminClient, fromCourseId: string, toCourseId: string): Promise<CopyResult> {
  const { from } = await loadSameSeriesPair(admin, fromCourseId, toCourseId);
  const [{ data: source }, { data: existing }] = await Promise.all([
    admin.from("personas").select("*").eq("course_id", fromCourseId).order("created_at", { ascending: true }),
    admin.from("personas").select("name").eq("course_id", toCourseId),
  ]);
  const names = new Set((existing ?? []).map((p) => p.name));
  let capacity = MAX_PERSONAS_PER_COURSE - (existing ?? []).length;

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const p of source ?? []) {
    if (names.has(p.name) || capacity <= 0) {
      skipped += 1;
      continue;
    }
    const { id: _id, created_at: _c, course_id: _cid, shared_at: _s, ...rest } = p as Record<string, unknown>;
    void _id; void _c; void _cid; void _s;
    rows.push({ ...rest, course_id: toCourseId, shared_at: null, origin_note: `${lessonName(from.lesson_no, from.title)}から複製` });
    names.add(p.name);
    capacity -= 1;
  }
  if (rows.length > 0) {
    const { error } = await admin.from("personas").insert(rows);
    if (error) throw new Error(`擬似メンバーの複製に失敗しました: ${error.message}`);
  }
  return { copied: rows.length, skipped };
}

/** 評価の観点を、同じ教科・科目の別の授業回から複製する。同じ名前の観点がすでにあれば複製しない。 */
export async function copyCriteriaBetweenLessons(admin: AdminClient, fromCourseId: string, toCourseId: string): Promise<CopyResult> {
  await loadSameSeriesPair(admin, fromCourseId, toCourseId);
  const [{ data: source }, { data: existing }] = await Promise.all([
    admin.from("evaluation_criteria").select("label, description, position").eq("course_id", fromCourseId).order("position", { ascending: true }),
    admin.from("evaluation_criteria").select("label, position").eq("course_id", toCourseId),
  ]);
  const labels = new Set((existing ?? []).map((c) => c.label));
  let position = Math.max(-1, ...(existing ?? []).map((c) => c.position)) + 1;

  const rows: { course_id: string; label: string; description: string | null; position: number }[] = [];
  let skipped = 0;
  for (const c of source ?? []) {
    if (labels.has(c.label)) {
      skipped += 1;
      continue;
    }
    rows.push({ course_id: toCourseId, label: c.label, description: c.description, position: position++ });
    labels.add(c.label);
  }
  if (rows.length > 0) {
    const { error } = await admin.from("evaluation_criteria").insert(rows);
    if (error) throw new Error(`評価の観点の複製に失敗しました: ${error.message}`);
  }
  return { copied: rows.length, skipped };
}
