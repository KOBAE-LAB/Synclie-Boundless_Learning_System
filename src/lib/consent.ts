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

/**
 * 同意の説明文を、大きく変えた日時。これより前に同意した学習者は、新しい説明(AIへの送信・国外での処理
 * など)を見ていないので、もう一度同意してもらう。説明文を大きく変えたら、この日時を新しくする。
 * (2026-10-21: 同意画面に「AIの利用について」を追加した)
 */
export const CONSENT_TEXT_UPDATED_AT = "2026-10-21T00:00:00+09:00";

/** この同意の記録が、いまの説明文に対する、有効な(撤回しておらず、最新の説明に同意した)ものか。 */
export function isConsentCurrent(
  consent: { granted_at: string | null; withdrawn_at: string | null } | null | undefined,
): boolean {
  if (!consent || consent.withdrawn_at || !consent.granted_at) return false;
  return new Date(consent.granted_at).getTime() >= new Date(CONSENT_TEXT_UPDATED_AT).getTime();
}

/** 同意はしたが、説明文が更新される前だったため、再同意が必要か(撤回済みは含まない)。 */
export function needsReconsent(
  consent: { granted_at: string | null; withdrawn_at: string | null } | null | undefined,
): boolean {
  return !!consent && !consent.withdrawn_at && !isConsentCurrent(consent);
}

// 同意済み(撤回しておらず、最新の説明に同意した)かどうか。ページ側はredirectする requireConsent() を使い、
// リダイレクトでは返せないAPI(ストリーミングの発言送信など)はこちらで判定して403を返す。
export async function hasConsent(
  admin: ReturnType<typeof createAdminClient>,
  studentId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("consent_records")
    .select("granted_at, withdrawn_at")
    .eq("student_id", studentId)
    .eq("scope", "data_use")
    .maybeSingle();

  return isConsentCurrent(data);
}
