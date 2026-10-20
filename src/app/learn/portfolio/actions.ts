"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { parseAssessmentInput } from "@/lib/portfolio/assessment";
import { ownsSubmission, patchPortfolioEntry } from "@/lib/portfolio/entries";
import { computeExpiry, generateShareToken } from "@/lib/portfolio/share";

// ポートフォリオ。学習者本人だけが、自分の成果の自己評価・公開の選択・公開リンクを操作できる。

export async function saveSelfAssessmentAction(submissionId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  if (!(await ownsSubmission(admin, user.id, submissionId))) {
    throw new Error("この成果を操作する権限がありません。");
  }
  const assessment = parseAssessmentInput({
    rating: String(formData.get("rating") ?? ""),
    comment: String(formData.get("comment") ?? ""),
  });
  await patchPortfolioEntry(admin, user.id, submissionId, { self_assessment: assessment });
  revalidatePath("/learn/portfolio");
}

export async function toggleSharedAction(submissionId: string, shared: boolean) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  if (!(await ownsSubmission(admin, user.id, submissionId))) {
    throw new Error("この成果を操作する権限がありません。");
  }
  await patchPortfolioEntry(admin, user.id, submissionId, { shared });
  revalidatePath("/learn/portfolio");
}

export async function createShareLinkAction(formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  const days = Number.parseInt(String(formData.get("days") ?? "7"), 10);
  const label = String(formData.get("label") ?? "").trim().slice(0, 60);
  const { error } = await admin.from("portfolio_share_links").insert({
    student_id: user.id,
    token: generateShareToken(),
    label: label || null,
    expires_at: computeExpiry(days),
  });
  if (error) throw new Error("公開リンクを作れませんでした。");
  revalidatePath("/learn/portfolio");
}

export async function revokeShareLinkAction(linkId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  // 自分のリンクだけを取り消せる(student_idで絞る)。
  await admin
    .from("portfolio_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("student_id", user.id)
    .is("revoked_at", null);
  revalidatePath("/learn/portfolio");
}
