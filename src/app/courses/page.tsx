import Link from "next/link";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { createSeriesAction } from "./actions";

export default async function CoursesPage() {
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const showAdminLink = await isAdmin(admin, user.id);
  const { count: pendingTeacherCount } = showAdminLink
    ? await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "teacher")
        .eq("approval_status", "pending")
    : { count: 0 };

  const { data: seriesRows } = await admin
    .from("course_series")
    .select("id, title, subject, created_at")
    .eq("owner_teacher_id", user.id)
    .order("created_at", { ascending: false });
  const seriesList = seriesRows ?? [];
  const seriesIds = seriesList.map((x) => x.id);

  // 各シリーズの授業回の数・履修者の数・承認待ちの数。
  const lessonCount = new Map<string, number>();
  const enrolledCount = new Map<string, number>();
  const pendingCount = new Map<string, number>();
  if (seriesIds.length > 0) {
    const [{ data: lessons }, { data: enrollments }] = await Promise.all([
      admin.from("courses").select("series_id").in("series_id", seriesIds),
      admin.from("series_enrollments").select("series_id, status").in("series_id", seriesIds),
    ]);
    for (const l of lessons ?? []) lessonCount.set(l.series_id, (lessonCount.get(l.series_id) ?? 0) + 1);
    for (const e of enrollments ?? []) {
      const map = e.status === "pending" ? pendingCount : enrolledCount;
      map.set(e.series_id, (map.get(e.series_id) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">授業シリーズ一覧</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {user.name ?? user.email} さんが担当する授業
      </p>
      {showAdminLink && (
        <Link
          href="/admin/teachers"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">教師の承認(管理者)</span>
          <span className={pendingTeacherCount ? "font-medium text-warn" : "text-ink-muted"}>
            {pendingTeacherCount ? `${pendingTeacherCount}件が承認待ち →` : "承認待ちはありません →"}
          </span>
        </Link>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">担当している授業シリーズ({seriesList.length})</h2>
      <ul className="mt-3 space-y-2">
        {seriesList.map((series) => (
          <li key={series.id}>
            <Link
              href={`/series/${series.id}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
            >
              <span>
                <span className="font-medium text-ink">{series.title}</span>
                {series.subject && <span className="ml-2 text-ink-muted">({series.subject})</span>}
              </span>
              <span className="text-xs text-ink-muted">
                {lessonCount.get(series.id) ?? 0}回・履修{enrolledCount.get(series.id) ?? 0}人
                {(pendingCount.get(series.id) ?? 0) > 0 && (
                  <span className="ml-1 font-medium text-warn">・承認待ち{pendingCount.get(series.id)}人</span>
                )}
              </span>
            </Link>
          </li>
        ))}
        {seriesList.length === 0 && (
          <li className="text-sm text-ink-muted">まだ授業シリーズがありません。下のフォームから作成してください。</li>
        )}
      </ul>

      <details open={seriesList.length === 0} className="mt-6 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">新しい授業シリーズを作成</summary>
        <p className="mt-2 text-sm text-ink-muted">科目や講座の単位です。作成後、その中に授業回(第1回、第2回…)を作ります。</p>
        <form action={createSeriesAction} className="mt-4 space-y-3">
          <label htmlFor="series-title" className="sr-only">シリーズの名前</label>
          <input
            id="series-title"
            name="title"
            placeholder="シリーズの名前(例: 理科1年 光合成)"
            required
            maxLength={80}
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
          <label htmlFor="series-subject" className="sr-only">教科</label>
          <input
            id="series-subject"
            name="subject"
            placeholder="教科(任意)"
            maxLength={40}
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
          <SubmitButton pendingText="作成中…" className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
            作成する
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
