"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getT } from "@/lib/i18n/server";

export type LoginState = { error?: string } | undefined;

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const { t } = await getT();
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      // ロールごとの行き先はトップページ(/)でまとめて振り分ける(教師→/courses、学習者→/learn)。
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as { code?: string }).code;
      if (code === "pending_approval") {
        return { error: t("login.errPending") };
      }
      if (code === "rejected") {
        return { error: t("login.errRejected") };
      }
      return { error: t("login.errInvalid") };
    }
    // NextAuth はリダイレクト成功時に例外を投げて遷移させる実装のため、再送出する。
    throw error;
  }
}

// F22: SSO。プロバイダーは環境変数が設定されている時だけログイン画面に表示される
// (src/app/login/page.tsx参照)。
export async function signInWithMicrosoftAction() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}

export async function signInWithGoogleAction() {
  await signIn("google", { redirectTo: "/" });
}
