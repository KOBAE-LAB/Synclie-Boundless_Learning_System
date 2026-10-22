import Link from "next/link";
import Image from "next/image";
import { SubmitButton } from "@/components/submit-button";
import { signupTeacherAction } from "../actions";

export default async function SignupTeacherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div>
          <Image src="/logo.png" alt="" width={56} height={56} priority className="mb-3 rounded-full" />
          <h1 className="text-xl font-semibold text-ink">教師として登録</h1>
          <p className="mt-1 text-sm text-ink-muted">
            登録後、管理者が承認するまでログインできません。承認されると利用できます。
          </p>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <form action={signupTeacherAction} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium text-ink">
              お名前
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={50}
              autoComplete="name"
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-ink">
              メールアドレス
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-ink">
              パスワード(10文字以上)
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          <SubmitButton
            pendingText="登録中…"
            className="w-full rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-fill-hover disabled:opacity-50"
          >
            登録する
          </SubmitButton>
        </form>

        <Link href="/signup" className="inline-block text-sm text-ink-muted underline underline-offset-2">
          ← 戻る
        </Link>
      </div>
    </div>
  );
}
