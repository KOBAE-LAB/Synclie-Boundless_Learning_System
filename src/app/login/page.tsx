import Image from "next/image";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signInWithMicrosoftAction, signInWithGoogleAction } from "./actions";
import { GoogleLogo, MicrosoftLogo } from "@/components/provider-logos";

// F22: SSOのボタンは、対応する環境変数(OAuthアプリの登録情報)が設定されている時だけ
// 表示する。サーバーコンポーネントでprocess.envを直接見て判定する
// (未設定の環境では段階1のCredentialsログインだけが表示される)。
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; error?: string }>;
}) {
  const { registered, error } = await searchParams;
  // src/auth.ts と同じ条件(IDとISSUERが揃っている時だけ有効)
  const microsoftEnabled = Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  );
  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID);
  const ssoEnabled = microsoftEnabled || googleEnabled;

  // SSO側で入れなかった理由(Auth.jsは ?error= で返す)。承認待ちの教師アカウントなどが該当する。
  const errorMessage = error
    ? error === "AccessDenied"
      ? "このアカウントではログインできませんでした。承認待ちの教師アカウントや、メールアドレスの確認ができなかった場合などが考えられます。"
      : "ログインに失敗しました。もう一度お試しください。"
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div className="text-center">
          <Image
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            priority
            className="mx-auto mb-3 rounded-full"
          />
          <h1 className="text-xl font-semibold text-ink">Synclie にログイン</h1>
          <p className="mt-1 text-xs tracking-wide text-ink-muted">Boundless Learning System</p>
        </div>

        {registered === "student" && (
          <p className="rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
            登録しました。ログインして、先生が承認するまでお待ちください(承認されると授業に入れます)。
          </p>
        )}
        {registered === "teacher" && (
          <p className="rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
            登録を受け付けました。管理者が承認するまでログインできません。
          </p>
        )}
        {errorMessage && (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        {ssoEnabled && (
          <div className="space-y-2">
            {googleEnabled && (
              <form action={signInWithGoogleAction}>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f7f8f8]"
                >
                  <GoogleLogo />
                  Googleでログイン
                </button>
              </form>
            )}
            {microsoftEnabled && (
              <form action={signInWithMicrosoftAction}>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-3 rounded-md border border-[#8c8c8c] bg-white px-4 py-2.5 text-sm font-medium text-[#5e5e5e] transition-colors hover:bg-[#f7f8f8]"
                >
                  <MicrosoftLogo />
                  Microsoftでログイン
                </button>
              </form>
            )}
            <p className="text-center text-xs text-ink-faint">
              はじめての方は、ログイン後に先生から教わった授業コードで授業に参加できます。
            </p>
          </div>
        )}

        {ssoEnabled && (
          <div className="flex items-center gap-3 text-xs text-ink-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            メールアドレスでログイン
            <span className="h-px flex-1 bg-line" />
          </div>
        )}

        <LoginForm />

        <p className="text-center text-sm text-ink-muted">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup" className="font-medium text-ink underline">
            新規登録
          </Link>
        </p>
      </div>
    </div>
  );
}
