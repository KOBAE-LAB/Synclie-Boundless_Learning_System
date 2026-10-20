import { requireRole } from "@/lib/auth/session";
import { requireConsent } from "@/lib/consent";
import { createAdminClient } from "@/lib/supabase/server";
import { joinCourseByCodeAction } from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 履修登録。教師から伝えられた授業コードを入力して、授業シリーズを履修する。
export default async function JoinCoursePage() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current="履修登録" />

      <h1 className="text-2xl font-semibold text-ink">履修登録</h1>
      <p className="mt-1 text-sm text-ink-muted">
        担当の先生から伝えられた授業コードを入力してください。申請後、先生が承認すると履修できます。
      </p>

      <form action={joinCourseByCodeAction} className="mt-6 space-y-3">
        <label htmlFor="join-code" className="sr-only">
          授業コード
        </label>
        <input
          id="join-code"
          name="code"
          required
          placeholder="例: A1B2C3"
          autoCapitalize="characters"
          className="w-full rounded-md border border-line px-3 py-2 text-sm uppercase tracking-widest bg-surface-raised"
        />
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          申請する
        </button>
      </form>
    </div>
  );
}
