"use server";

import { getT } from "@/lib/i18n/server";
import type { DictKey, Vars } from "@/lib/i18n/translate";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { copyCriteriaBetweenLessons, copyPersonasBetweenLessons } from "@/lib/courses/lesson-copy";

// 画面の言語でのメッセージ(エラーなど)。
async function msg(key: DictKey, vars?: Vars): Promise<string> {
  return (await getT()).t(key, vars);
}

// 同じ教科・科目の別の授業回から、擬似メンバー・評価の観点を複製する(前の回の設定を引き継ぐ)。
// 複製元・複製先の両方が、自分の授業回であることを確かめる(同じ教科・科目かどうかは複製処理側で確かめる)。
async function guardPair(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  const fromCourseId = String(formData.get("fromCourseId") ?? "");
  if (!fromCourseId) throw new Error((await msg("lessonCopy.pickSource")));
  await assertOwnsCourse(admin, courseId, user.id);
  await assertOwnsCourse(admin, fromCourseId, user.id);
  return { admin, fromCourseId };
}

export async function copyPersonasFromLessonAction(courseId: string, formData: FormData) {
  const { admin, fromCourseId } = await guardPair(courseId, formData);
  const result = await copyPersonasBetweenLessons(admin, fromCourseId, courseId);
  redirect(`/courses/${courseId}/personas?copied=${result.copied}&skipped=${result.skipped}`);
}

export async function copyCriteriaFromLessonAction(courseId: string, formData: FormData) {
  const { admin, fromCourseId } = await guardPair(courseId, formData);
  const result = await copyCriteriaBetweenLessons(admin, fromCourseId, courseId);
  redirect(`/courses/${courseId}/criteria?copied=${result.copied}&skipped=${result.skipped}`);
}
