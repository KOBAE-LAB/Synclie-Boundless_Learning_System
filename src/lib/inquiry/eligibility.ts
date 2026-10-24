// 記録を材料にしてよい学習者か(②抽出層・先輩型・集約型で共通)。pipeline.ts から切り出した(循環参照を避けるため)。
import type { createAdminClient } from "@/lib/supabase/server";
import { hasConsent } from "@/lib/consent";

type AdminClient = ReturnType<typeof createAdminClient>;

/** 抽出の対象にしてよい学習者か: 同意していて、管理者のテスト学習者ではない(いまの学習進化型ペルソナと同じ基準)。 */
export async function isEligibleLearner(admin: AdminClient, studentId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("test_owner_id").eq("id", studentId).maybeSingle();
  if (!profile || profile.test_owner_id) return false;
  return hasConsent(admin, studentId);
}
