import Link from "next/link";
import { requireLogin } from "@/lib/auth/session";
import { changePasswordAction } from "./actions";

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { user } = await requireLogin();
  const { error, done } = await searchParams;
  const home = user.role === "teacher" ? "/courses" : "/learn";

  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">パスワード変更</h1>
      <p className="mt-1 text-sm text-ink-muted">{user.name ?? user.email}</p>

      {done && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted" role="status">
          パスワードを変更しました。
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <form action={changePasswordAction} className="mt-6 space-y-4">
        <div className="space-y-1">
          <label htmlFor="current" className="text-sm font-medium text-ink">
            現在のパスワード
          </label>
          <input
            id="current"
            name="current"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="next" className="text-sm font-medium text-ink">
            新しいパスワード(10文字以上)
          </label>
          <input
            id="next"
            name="next"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          変更する
        </button>
      </form>

      <Link href={home} className="mt-6 inline-block text-sm text-ink-muted hover:underline">
        ← 戻る
      </Link>
    </div>
  );
}
