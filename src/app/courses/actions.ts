"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// 授業シリーズ(科目・講座)の作成。履修登録(参加コード)の単位で、その中に授業回を重ねていく。
// RLSが未整備の段階1では、role確認をアプリ側(requireRole)で行い、
// 管理者クライアント(サービスロール)でDB操作する。
export async function createSeriesAction(formData: FormData) {
  const session = await requireRole("teacher");
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 40);

  if (!title) {
    throw new Error("シリーズの名前を入力してください。");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("course_series")
    .insert({ owner_teacher_id: session.user.id, title, subject: subject || null })
    .select("id")
    .single();

  if (error) {
    throw new Error(`授業シリーズの作成に失敗しました: ${error.message}`);
  }

  revalidatePath("/courses");
  redirect(`/series/${data.id}`);
}
