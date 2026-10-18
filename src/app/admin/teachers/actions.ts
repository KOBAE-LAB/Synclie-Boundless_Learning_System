"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// 教師の自己登録の承認。管理者(profiles.is_admin)だけが実行できる。
// 承認された教師はその場からログインできるようになる(src/auth.ts の authorize 参照)。
async function setApproval(teacherId: string, status: "approved" | "rejected") {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ approval_status: status })
    .eq("id", teacherId)
    .eq("role", "teacher");
  if (error) {
    throw new Error(`更新に失敗しました: ${error.message}`);
  }
  revalidatePath("/admin/teachers");
}

export async function approveTeacherAction(teacherId: string) {
  await setApproval(teacherId, "approved");
}

export async function rejectTeacherAction(teacherId: string) {
  await setApproval(teacherId, "rejected");
}
