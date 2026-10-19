import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";

// F16: 同意・データ管理。同意していない(または撤回済みの)学習者は
// 対話・提出などのデータを扱う画面に入れないようにし、/consent へ誘導する。
export async function requireConsent(
  admin: ReturnType<typeof createAdminClient>,
  studentId: string,
) {
  if (!(await hasConsent(admin, studentId))) {
    redirect("/consent");
  }
}

// 同意済み(撤回していない)かどうか。ページ側はredirectする requireConsent() を使い、
// リダイレクトでは返せないAPI(ストリーミングの発言送信など)はこちらで判定して403を返す。
export async function hasConsent(
  admin: ReturnType<typeof createAdminClient>,
  studentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("consent_records")
    .select("withdrawn_at")
    .eq("student_id", studentId)
    .maybeSingle();

  return !!data && !data.withdrawn_at;
}
