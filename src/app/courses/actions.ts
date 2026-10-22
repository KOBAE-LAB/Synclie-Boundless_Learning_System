"use server";

import { revalidatePath } from "next/cache";
import { closeInquiryForSeries } from "@/lib/inquiry/project-stage";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { fiscalYearOfDate } from "@/lib/courses/series";

// 教科・科目(科目・講座)の作成。履修登録(参加コード)の単位で、その中に授業回を重ねていく。
// RLSが未整備の段階1では、role確認をアプリ側(requireRole)で行い、
// 管理者クライアント(サービスロール)でDB操作する。
export async function createSeriesAction(formData: FormData) {
  const session = await requireRole("teacher");
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 40);
  const planned = Number.parseInt(String(formData.get("plannedLessons") ?? ""), 10);
  const year = Number.parseInt(String(formData.get("fiscalYear") ?? ""), 10);
  // 探究: 人間のグループで、時間差で議論する(0044)。作成後は変えない(議論の記録の単位が変わるため)。
  const kind = formData.get("kind") === "inquiry" ? "inquiry" : "standard";

  if (!title) {
    throw new Error("教科・科目の名前を入力してください。");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("course_series")
    .insert({
      owner_teacher_id: session.user.id,
      title,
      subject: subject || null,
      kind,
      planned_lessons: Number.isInteger(planned) && planned >= 1 && planned <= 60 ? planned : null,
      fiscal_year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fiscalYearOfDate(new Date()),
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`教科・科目の作成に失敗しました: ${error.message}`);
  }

  revalidatePath("/courses");
  redirect(`/series/${data.id}`);
}

// 年度末の一括処理: 指定した年度の、自分が担当する(まだ閉じていない)教科・科目を、まとめてアーカイブする。
export async function archiveYearAction(formData: FormData) {
  const session = await requireRole("teacher");
  const year = Number.parseInt(String(formData.get("fiscalYear") ?? ""), 10);
  if (!Number.isInteger(year)) {
    throw new Error("年度を選んでください。");
  }
  const admin = createAdminClient();
  const { data: archived, error } = await admin
    .from("course_series")
    .update({ archived_at: new Date().toISOString() })
    .eq("owner_teacher_id", session.user.id)
    .eq("fiscal_year", year)
    .is("archived_at", null)
    .select("id");
  if (error) {
    throw new Error(`一括アーカイブに失敗しました: ${error.message}`);
  }
  // 探究の終了(要件定義書14章ステップ5): 最後の段階の物語と、振り返り版を作る(後処理)。
  await closeInquiryForSeries(admin, (archived ?? []).map((s) => s.id as string));
  revalidatePath("/courses");
}
