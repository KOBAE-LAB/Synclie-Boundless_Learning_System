"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// F01拡張: 受講登録。教師が発行した授業コード(courses.join_code)を学習者が入力して
// 参加登録(course_enrollments)する。コードは大文字小文字・前後の空白を気にせず受け付ける。
export async function joinCourseByCodeAction(formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!rawCode) {
    throw new Error("授業コードを入力してください。");
  }

  const { data: course } = await admin
    .from("courses")
    .select("id, title")
    .eq("join_code", rawCode)
    .maybeSingle();
  if (!course) {
    throw new Error("そのコードの授業が見つかりません。コードを確認してください。");
  }

  const { error } = await admin
    .from("course_enrollments")
    .upsert({ course_id: course.id, student_id: user.id }, { onConflict: "course_id,student_id" });
  if (error) {
    throw new Error(`参加登録に失敗しました: ${error.message}`);
  }

  redirect(`/learn/${course.id}`);
}
