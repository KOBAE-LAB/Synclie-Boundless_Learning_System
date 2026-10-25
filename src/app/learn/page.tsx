import { StudyModeBadge } from "@/components/study-mode-badge";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { seriesLabel } from "@/lib/courses/series";
import { getT } from "@/lib/i18n/server";
import type { Lang } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";

// 学習者には、履修登録した教科・科目だけを見せる(教科・科目を選ぶと、公開されている授業回の一覧に進む)。
export default async function LearnCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ not_enrolled?: string; requested?: string }>;
}) {
  const { user } = await requireRole("student");
  const { not_enrolled, requested } = await searchParams;
  const { t, lang } = await getT();

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
          .select("id, title, subject, kind, planned_lessons, archived_at")
          .in("id", enrolledSeriesIds)
          .order("created_at", { ascending: false })
      : { data: [] };
  const { data: pendingSeries } =
    pendingSeriesIds.length > 0
      ? await admin.from("course_series").select("id, title").in("id", pendingSeriesIds)
      : { data: [] };

  // 各教科・科目の、公開されている授業回の数(学習者が開ける回)。
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
      <h1 className="text-2xl font-semibold text-ink">{t("learnList.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("learnList.san", { name: user.name ?? user.email ?? "" })}</p>
      <Link
        href="/learn/join"
        className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm hover:border-accent hover:bg-surface"
      >
        <span className="font-medium text-ink">{t("learnList.joinTitle")}</span>
        <span className="text-ink-muted">{t("learnList.joinHint")}</span>
      </Link>

      {not_enrolled && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          {t("learnList.notEnrolled")}
          <Link href="/learn/join" className="ml-1 font-semibold underline underline-offset-2">
            {t("learnList.toJoin")}
          </Link>
        </p>
      )}

      {requested && (
        <p className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          {t("learnList.requested")}
        </p>
      )}

      {(pendingSeries ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-medium text-ink-faint">{t("learnList.pendingHeading")}</h2>
          <ul className="mt-2 space-y-1">
            {(pendingSeries ?? []).map((c) => (
              <li key={c.id} className="text-sm text-ink-muted">
                {t("learnList.pendingItem", { title: c.title })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">{t("learnList.enrolledHeading")}</h2>
      <ul className="mt-3 space-y-2">
        {activeSeries.map((series) => (
          <li key={series.id}>
            <SeriesLink series={series} releasedCount={releasedCount.get(series.id) ?? 0} t={t} lang={lang} />
          </li>
        ))}
        {activeSeries.length === 0 && (
          <li className="text-sm text-ink-muted">
            {pastSeries.length > 0 ? t("learnList.noneActive") : t("learnList.noneYet")}
            {pastSeries.length === 0 && (
              <>
                <Link href="/learn/join" className="mx-1 underline">
                  {t("learnList.here")}
                </Link>
                {t("learnList.fromHereJoin")}
              </>
            )}
          </li>
        )}
      </ul>

      {pastSeries.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink">{t("learnList.pastHeading")}</h2>
          <ul className="mt-3 space-y-2">
            {pastSeries.map((series) => (
              <li key={series.id}>
                <SeriesLink series={series} releasedCount={releasedCount.get(series.id) ?? 0} t={t} lang={lang} />
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
  t,
  lang,
}: {
  series: { id: string; title: string; subject: string | null; kind: string; planned_lessons: number | null };
  releasedCount: number;
  t: Translator;
  lang: Lang;
}) {
  return (
    <Link
      href={`/learn/series/${series.id}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
    >
      <span>
        <span className="font-medium text-ink">{seriesLabel(series.title, series.planned_lessons, lang)}</span>
        {series.subject && <span className="ml-2 text-ink-muted">({series.subject})</span>}
        <span className="ml-2"><StudyModeBadge kind={series.kind} /></span>
      </span>
      <span className="text-xs text-ink-muted">{t("learnList.released", { n: releasedCount })}</span>
    </Link>
  );
}
