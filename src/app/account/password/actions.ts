"use server";

import { redirect } from "next/navigation";
import { requireLogin } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getT } from "@/lib/i18n/server";
import { validatePassword } from "@/lib/auth/signup-validation";
import { createAdminClient } from "@/lib/supabase/server";

// ログイン中の本人が自分のパスワードを変える(教師が決めた初期パスワードの変更用)。
// 現在のパスワードの入力を必須にし、セッションを乗っ取られても変えられないようにする。
export async function changePasswordAction(formData: FormData) {
  const { user } = await requireLogin();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  const { t, lang } = await getT();
  const fail = (message: string): never =>
    redirect(`/account/password?error=${encodeURIComponent(message)}`);

  const problem = validatePassword(next, lang);
  if (problem) fail(problem);

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("password_hash")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.password_hash) {
    fail(t("account.errNoPassword"));
  }
  if (!(await verifyPassword(current, profile!.password_hash))) {
    fail(t("account.errWrongCurrent"));
  }

  const { error } = await admin
    .from("profiles")
    .update({ password_hash: await hashPassword(next) })
    .eq("id", user.id);
  if (error) {
    fail(t("account.errFailed"));
  }

  redirect("/account/password?done=1");
}
