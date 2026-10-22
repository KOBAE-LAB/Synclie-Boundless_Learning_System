import Link from "next/link";
import Image from "next/image";

// サインアップの入口。学習者(授業コードで申請)か教師(管理者の承認制)かを選ぶ。
export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-line bg-surface p-8 shadow-sm">
        <div>
          <Image src="/logo.png" alt="" width={56} height={56} priority className="mb-3 rounded-full" />
          <h1 className="text-xl font-semibold text-ink">新規登録</h1>
          <p className="mt-1 text-sm text-ink-muted">あてはまるほうを選んでください。</p>
        </div>

        <Link
          href="/signup/student"
          className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">学習者として登録</span>
          <span className="mt-1 block text-xs text-ink-muted">
            先生から伝えられた「授業コード」が必要です。先生が承認すると授業に入れます。
          </span>
        </Link>
        <Link
          href="/signup/teacher"
          className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">教師として登録</span>
          <span className="mt-1 block text-xs text-ink-muted">
            管理者が承認するまでログインできません。
          </span>
        </Link>

        <Link href="/login" className="inline-block text-sm text-ink-muted underline underline-offset-2">
          ← ログインに戻る
        </Link>
      </div>
    </div>
  );
}
