import type { createAdminClient } from "@/lib/supabase/server";
import type { Assessment } from "./assessment";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface EntryPatch {
  self_assessment?: Assessment | null;
  teacher_assessment?: Assessment | null;
  shared?: boolean;
}

/**
 * 成果1件ごとの記録(portfolio_entries)を作る/更新する。
 * 部分的な一意インデックスは upsert の onConflict に使えないため、読んでから書く。
 * 呼び出し側が「この成果に触れてよい人か」を確認した後に呼ぶこと。
 */
export async function patchPortfolioEntry(
  admin: AdminClient,
  studentId: string,
  submissionId: string,
  patch: EntryPatch,
) {
  const { data: existing } = await admin
    .from("portfolio_entries")
    .select("id")
    .eq("submission_id", submissionId)
    .maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await admin.from("portfolio_entries").update({ ...patch, updated_at: now }).eq("id", existing.id);
    if (error) throw new Error("保存に失敗しました。");
  } else {
    const { error } = await admin
      .from("portfolio_entries")
      .insert({ student_id: studentId, submission_id: submissionId, ...patch, updated_at: now });
    if (error) throw new Error("保存に失敗しました。");
  }
}

/** この成果が、その学習者本人のものか。 */
export async function ownsSubmission(admin: AdminClient, studentId: string, submissionId: string): Promise<boolean> {
  const { data } = await admin.from("submissions").select("student_id").eq("id", submissionId).maybeSingle();
  return data?.student_id === studentId;
}
