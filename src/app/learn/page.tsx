import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { seriesLabel } from "@/lib/courses/series";

// 学習者には、履修登録した授業シリーズだけを見せる(シリーズを選ぶと、公開されている授業回の一覧に進む)。
export default async function LearnCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ not_enrolled?: string; requested?: string }>;
}) {
  const { user } = await requireRole("student");
  const { not_enrolled, requested } = await searchParams;

  const admin = createAdminClient();
  await requireConsent(admin, user.id);

  const { data: enrollments } = await admin
    .from("series_enrollments")
    .select("series_id, status")
    .eq("student_id", user.id);
  const enrolledSeriesIds = (enrollments ?? []).filter((e) => e.status === "approved").map((e) => e.series_id);
  const pendingSeriesIds = (enrollments ?? []).filter((e) => e.status === "pending").map((e) => e.series_id);

  const { data: seriesRows } =
    enrolledSeriesIds.length > 0
      ? await admin
          .from("course_series")
          .select("id, title, subject, planned_lessons, archived_at")
          .in("id", enrolledSeriesIds)
          .order("created_at", { ascending: false })
      : { data: [] };
  const { data: pendingSeries } =
    pendingSeriesIds.length > 0
      ? await admin.from("course_series").select("id, title").in("id", pendingSeriesIds)
      : { data: [] };

  // 各シリーズの、公開されている授業回の数(学習者が開ける回)。
  const activeSeries = (seriesRows ?? []).filter((x) => !x.archived_at);
  const pastSeries = (seriesRows ?? []).filter((x) => x.archived_at);
  const releasedCount = new Map<string, number>();
  if (enrolledSeriesIds.length > 0) {
    const { data: lessons } = await admin
      .from("courses")
      .select("series_id")
      .in("series_id", enrolledSeriesIds)
      .eq("released", true);
    for (const l of lessons ?? []) releasedCount.set(l.series_id, (releasedCount.get(l.series_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">授業一覧</h1>
      <p className="mt-1 text-sm text-ink-muted">{user.name ?? user.email} さん</p>
      <Link
        href="/learn/join"
        className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm hover:border-accent hover:bg-surface"
      >
        <span className="font-medium text-ink">授業コードで履修登録する</span>
        <span className="text-ink-muted">先生から教わったコードを入力 →</span>
      </Link>

      {not_enrolled && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          その授業はまだ開けません(履修登録が未了、または公開前です)。履修登録は、担当の先生から授業コードをもらい、
          <Link href="/learn/join" className="mx-1 underline">
            こちら
          </Link>
          から参加してください。
        </p>
      )}

      {requested && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          履修を申請しました。担当の先生が承認すると、下の一覧に表示されます。
        </p>
      )}

      {(pendingSeries ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-medium text-ink-faint">承認待ちのシリーズ</h2>
          <ul className="mt-2 space-y-1">
            {(pendingSeries ?? []).map((c) => (
              <li key={c.id} className="text-sm text-ink-muted">
                {c.title}(先生の承認を待っています)
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">履修している授業シリーズ</h2>
      <ul className="mt-3 space-y-2">
        {activeSeries.map((series) => (
          <li key={series.id}>
            <SeriesLink series={series} releasedCount={releasedCount.get(series.id) ?? 0} />
          </li>
        ))}
        {activeSeries.length === 0 && (
          <li className="text-sm text-ink-muted">
            {pastSeries.length > 0 ? "いま履修中のシリーズはありません。" : "まだ履修している授業がありません。先生から授業コードをもらったら"}
            {pastSeries.length === 0 && (
              <>
                <Link href="/learn/join" className="mx-1 underline">
                  こちら
                </Link>
                から履修登録してください。
              </>
            )}
          </li>
        )}
      </ul>

      {pastSeries.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink">過去のシリーズ(記録の閲覧のみ)</h2>
          <ul className="mt-3 space-y-2">
            {pastSeries.map((series) => (
              <li key={series.id}>
                <SeriesLink series={series} releasedCount={releasedCount.get(series.id) ?? 0} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SeriesLink({
  series,
  releasedCount,
}: {
  series: { id: string; title: string; subject: string | null; planned_lessons: number | null };
  releasedCount: number;
}) {
  return (
    <Link
      href={`/learn/series/${series.id}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
    >
      <span>
        <span className="font-medium text-ink">{seriesLabel(series.title, series.planned_lessons)}</span>
        {series.subject && <span className="ml-2 text-ink-muted">({series.subject})</span>}
      </span>
      <span className="text-xs text-ink-muted">公開中 {releasedCount}回</span>
    </Link>
  );
}
