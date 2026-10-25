"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

// 履修登録。教師が発行した授業コード(course_series.join_code)を学習者が入力して
// 教科・科目への履修を申請する(series_enrollments, status='pending')。教師が承認して初めて授業に入れる
// (授業コードが漏れても、知らない人がそのまま入ってAIを使えないようにするため)。
// コードは大文字小文字・前後の空白を気にせず受け付ける。
export async function joinCourseByCodeAction(formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  const { t } = await getT();

  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!rawCode) {
    throw new Error(t("join.errCodeEmpty"));
  }

  const { data: series } = await admin
    .from("course_series")
    .select("id, title, archived_at")
    .eq("join_code", rawCode)
    .maybeSingle();
  if (!series) {
    throw new Error(t("join.errNotFound"));
  }

  if (series.archived_at) {
    throw new Error(t("join.errArchived"));
  }

  const { data: existing } = await admin
    .from("series_enrollments")
    .select("status")
    .eq("series_id", series.id)
    .eq("student_id", user.id)
    .maybeSingle();

  // 既に承認済みならそのまま授業へ。申請済み(承認待ち)ならそのまま一覧へ。
  if (existing?.status === "approved") {
    redirect(`/learn/series/${series.id}`);
  }
  if (!existing) {
    const { error } = await admin
      .from("series_enrollments")
      .insert({ series_id: series.id, student_id: user.id, status: "pending" });
    if (error) {
      throw new Error(t("join.errFailed", { message: error.message }));
    }
  }

  redirect("/learn?requested=1");
}
