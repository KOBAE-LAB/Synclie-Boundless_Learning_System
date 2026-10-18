import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { approveTeacherAction, rejectTeacherAction } from "./actions";

// 管理者専用: 教師の自己登録(サインアップ)の承認。
export default async function AdminTeachersPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: teachers } = await admin
    .from("profiles")
    .select("id, display_name, email, approval_status, created_at")
    .eq("role", "teacher")
    .in("approval_status", ["pending", "rejected"])
    .order("created_at", { ascending: true });

  const pending = (teachers ?? []).filter((t) => t.approval_status === "pending");
  const rejected = (teachers ?? []).filter((t) => t.approval_status === "rejected");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">教師の承認</h1>
      <p className="mt-1 text-sm text-ink-muted">
        自己登録した教師は、ここで承認するまでログインできません。心当たりのない登録は却下してください。
      </p>

      <h2 className="mt-8 text-sm font-medium text-ink">承認待ち({pending.length}人)</h2>
      <ul className="mt-2 space-y-2">
        {pending.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line px-4 py-3 text-sm">
            <span>
              <span className="font-medium text-ink">{t.display_name}</span>
              <span className="ml-2 text-ink-muted">{t.email}</span>
              <span className="ml-2 text-xs text-ink-faint">{t.created_at.slice(0, 10)} 登録</span>
            </span>
            <span className="flex items-center gap-2">
              <form action={approveTeacherAction.bind(null, t.id)}>
                <button
                  type="submit"
                  className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover"
                >
                  承認する
                </button>
              </form>
              <form action={rejectTeacherAction.bind(null, t.id)}>
                <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                  却下する
                </button>
              </form>
            </span>
          </li>
        ))}
        {pending.length === 0 && <li className="text-sm text-ink-muted">承認待ちの教師はいません。</li>}
      </ul>

      {rejected.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink">却下済み({rejected.length}人)</h2>
          <ul className="mt-2 space-y-2">
            {rejected.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
                <span className="text-ink-muted">
                  {t.display_name} {t.email}
                </span>
                <form action={approveTeacherAction.bind(null, t.id)}>
                  <button type="submit" className="text-xs text-ink-faint hover:underline">
                    あらためて承認する
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/courses" className="mt-8 inline-block text-sm text-ink-muted hover:underline">
        ← 授業一覧に戻る
      </Link>
    </div>
  );
}
