import { getT } from "@/lib/i18n/server";
import { StudyModeBadge } from "@/components/study-mode-badge";
import Link from "next/link";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { fiscalYearOfDate, seriesLabel } from "@/lib/courses/series";
import { archiveYearAction, createSeriesAction } from "./actions";
import {
  archiveSeriesAction,
  carryOverSeriesAction,
  deleteSeriesAction,
  unarchiveSeriesAction,
} from "../series/[seriesId]/actions";

// 教師のホーム。用途ごとに、はっきり区切った4つの部分に分ける(区切りが無く使いにくい、という指摘を受けた)。
//   1. 担当している教科・科目(毎日使う。一覧だけ)  2. 教科・科目をつくる  3. 年度末の処理(終了・翌年度への引き継ぎ・削除)
//   4. 管理者メニュー(管理者だけに表示。教師の承認・組織の管理)

const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; archived?: string }>;
}) {
  const { year: yearParam, archived } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();

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
    .select("id, title, subject, kind, planned_lessons, fiscal_year, archived_at, created_at")
    .eq("owner_teacher_id", user.id)
    .order("fiscal_year", { ascending: false })
    .order("created_at", { ascending: false });
  const allSeries = seriesRows ?? [];

  const currentYear = fiscalYearOfDate(new Date());
  const years = [...new Set([currentYear, ...allSeries.map((s) => s.fiscal_year)])].sort((a, b) => b - a);
  const selectedYear = yearParam && yearParam !== "all" ? Number.parseInt(yearParam, 10) : null;
  const showArchived = archived === "1";
  const seriesList = allSeries.filter(
    (s) => (selectedYear === null || s.fiscal_year === selectedYear) && (showArchived || !s.archived_at),
  );
  const archivedHidden = allSeries.filter(
    (s) => (selectedYear === null || s.fiscal_year === selectedYear) && s.archived_at,
  ).length;
  const seriesIds = allSeries.map((x) => x.id);

  // 各教科・科目の授業回の数・履修者の数・承認待ちの数・学習者の記録の有無(記録があれば削除できない)。
  const lessonCount = new Map<string, number>();
  const enrolledCount = new Map<string, number>();
  const pendingCount = new Map<string, number>();
  const seriesWithRecords = new Set<string>();
  if (seriesIds.length > 0) {
    const [{ data: lessons }, { data: enrollments }] = await Promise.all([
      admin.from("courses").select("id, series_id").in("series_id", seriesIds),
      admin.from("series_enrollments").select("series_id, status").in("series_id", seriesIds),
    ]);
    const seriesOfLesson = new Map<string, string>();
    for (const l of lessons ?? []) {
      seriesOfLesson.set(l.id, l.series_id);
      lessonCount.set(l.series_id, (lessonCount.get(l.series_id) ?? 0) + 1);
    }
    for (const e of enrollments ?? []) {
      const map = e.status === "pending" ? pendingCount : enrolledCount;
      map.set(e.series_id, (map.get(e.series_id) ?? 0) + 1);
    }
    const lessonIds = [...seriesOfLesson.keys()];
    if (lessonIds.length > 0) {
      const [{ data: sessions }, { data: submissions }] = await Promise.all([
        admin.from("learning_sessions").select("course_id").in("course_id", lessonIds),
        admin.from("submissions").select("course_id").in("course_id", lessonIds),
      ]);
      for (const r of [...(sessions ?? []), ...(submissions ?? [])]) {
        const sid = seriesOfLesson.get(r.course_id);
        if (sid) seriesWithRecords.add(sid);
      }
    }
  }

  const activeInYear = (y: number) => allSeries.filter((s) => s.fiscal_year === y && !s.archived_at).length;

  const sectionClass = "mt-12 border-t border-line-soft pt-8";
  const h2Class = "text-lg font-semibold text-ink";
  const introClass = "mt-1 text-sm text-ink-muted";

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{t("teacherHome.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("teacherHome.taughtBy", { name: user.name ?? user.email ?? "" })}
      </p>
      {showAdminLink && !!pendingTeacherCount && (
        <p role="status" className="mt-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-ink">
          {t("teacherHome.pendingTeachers", { n: pendingTeacherCount ?? 0 })}
          <a href="#admin-menu" className="ml-1 underline underline-offset-2">{t("teacherHome.toAdmin")}</a>
        </p>
      )}

      <section aria-labelledby="series-h" className="mt-8">
        <h2 id="series-h" className={h2Class}>
          {t("teacherHome.taught", { n: seriesList.length })}
          {!showArchived && archivedHidden > 0 && (
            <span className="ml-2 text-xs font-normal text-ink-faint">{t("teacherHome.endedHidden", { n: archivedHidden })}</span>
          )}
        </h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="list-year" className="block text-xs text-ink-muted">{t("teacherHome.year")}</label>
            <select id="list-year" name="year" defaultValue={selectedYear ? String(selectedYear) : "all"} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="all">{t("teacherHome.all")}</option>
              {years.map((y) => (
                <option key={y} value={y}>{t("teacherHome.yearOption", { y })}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-muted">
            <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
            {t("teacherHome.showEnded")}
          </label>
          <button type="submit" className={small}>{t("teacherHome.filter")}</button>
        </form>
        <ul className="mt-4 space-y-2">
          {seriesList.map((series) => (
            <li key={series.id} className={`rounded-md border border-line ${series.archived_at ? "bg-surface" : ""}`}>
              <Link
                href={`/series/${series.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-surface"
              >
                <span>
                  <span className="font-medium text-ink">{seriesLabel(series.title, series.planned_lessons, lang)}</span>
                  <span className="ml-2 text-xs text-ink-faint">{t("teacherHome.yearOption", { y: series.fiscal_year })}</span>
                  <span className="ml-2"><StudyModeBadge kind={series.kind} /></span>
                  {series.subject && <span className="ml-2 text-ink-muted">({series.subject})</span>}
                  {series.archived_at && (
                    <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">{t("teacherHome.ended")}</span>
                  )}
                </span>
                <span className="text-xs text-ink-muted">
                  {t("teacherHome.lessonStats", { n: lessonCount.get(series.id) ?? 0, planned: series.planned_lessons ? `/${series.planned_lessons}` : "", e: enrolledCount.get(series.id) ?? 0 })}
                  {(pendingCount.get(series.id) ?? 0) > 0 && (
                    <span className="ml-1 font-medium text-warn">{t("teacherHome.pendingN", { n: pendingCount.get(series.id) ?? 0 })}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
          {seriesList.length === 0 && (
            <li className="text-sm text-ink-muted">
              {allSeries.length === 0 ? t("teacherHome.noSeries") : t("teacherHome.noMatch")}
            </li>
          )}
        </ul>
      </section>

      <section id="create" aria-labelledby="create-h" className={sectionClass}>
        <h2 id="create-h" className={h2Class}>{t("teacherHome.createTitle")}</h2>
        <p className={introClass}>{t("teacherHome.createLead")}</p>
        <details open={allSeries.length === 0} className="mt-3 rounded-lg border border-line p-5">
          <summary className="cursor-pointer text-sm font-medium text-ink">{t("teacherHome.createSummary")}</summary>
          <p className="mt-2 text-sm text-ink-muted">{t("teacherHome.modeFixed")}</p>
          <form action={createSeriesAction} className="mt-4 space-y-3">
            <label htmlFor="series-title" className="sr-only">{t("teacherHome.nameLabel")}</label>
            <input
              id="series-title"
              name="title"
              placeholder={t("teacherHome.namePlaceholder")}
              required
              maxLength={80}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <label htmlFor="series-subject" className="sr-only">{t("teacherHome.noteLabel")}</label>
            <input
              id="series-subject"
              name="subject"
              placeholder={t("teacherHome.notePlaceholder")}
              maxLength={40}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-ink-muted">
                {t("teacherHome.planned")}
                <input name="plannedLessons" type="number" min={1} max={60} placeholder={t("teacherHome.plannedPlaceholder")} className="mt-1 block w-28 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-ink-muted">
                {t("teacherHome.year")}
                <input name="fiscalYear" type="number" min={2000} max={2100} defaultValue={currentYear} className="mt-1 block w-28 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm" />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-ink-muted">{t("teacherHome.modeLegend")}</legend>
              {(["standard", "inquiry"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input type="radio" name="kind" value={mode} defaultChecked={mode === "standard"} className="mt-1" />
                  <span>
                    <span className="block font-medium text-ink">{t(`studyMode.${mode}`)}</span>
                    <span className="block text-xs text-ink-muted">{t(`studyMode.${mode}Summary`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <SubmitButton pendingText={t("teacherHome.creating")} className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
              {t("teacherHome.create")}
            </SubmitButton>
          </form>
        </details>
      </section>

      <section id="year-end" aria-labelledby="year-end-h" className={sectionClass}>
        <h2 id="year-end-h" className={h2Class}>{t("teacherHome.yearEndTitle")}</h2>
        <p className={introClass}>{t("teacherHome.yearEndLead")}</p>

        <div className="mt-4 rounded-lg border border-line p-5">
          <h3 className="text-sm font-medium text-ink">{t("teacherHome.endYearTitle")}</h3>
          <p className="mt-1 text-sm text-ink-muted">{t("teacherHome.endYearLead")}</p>
          <form action={archiveYearAction} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="archive-year" className="sr-only">{t("teacherHome.year")}</label>
            <select id="archive-year" name="fiscalYear" defaultValue={String(selectedYear ?? currentYear)} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              {years.map((y) => (
                <option key={y} value={y}>{t("teacherHome.yearCount", { y, n: activeInYear(y) })}</option>
              ))}
            </select>
            <SubmitButton pendingText={t("teacherHome.processing")} className={small}>{t("teacherHome.endYear")}</SubmitButton>
          </form>
        </div>

        <h3 className="mt-6 text-sm font-medium text-ink">{t("teacherHome.perSeries")}</h3>
        <ul className="mt-2 space-y-2">
          {seriesList.map((series) => {
            const hasRecords = seriesWithRecords.has(series.id);
            return (
              <li key={series.id} className={`rounded-md border border-line px-4 py-3 ${series.archived_at ? "bg-surface" : ""}`}>
                <p className="text-sm font-medium text-ink">
                  {seriesLabel(series.title, series.planned_lessons, lang)}
                  <span className="ml-2 text-xs font-normal text-ink-faint">{t("teacherHome.yearOption", { y: series.fiscal_year })}</span>
                  {series.archived_at && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">{t("teacherHome.ended")}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {series.archived_at ? (
                    <form action={unarchiveSeriesAction.bind(null, series.id)}>
                      <SubmitButton pendingText={t("teacherHome.reopening")} className={small}>{t("teacherHome.reopen")}</SubmitButton>
                    </form>
                  ) : (
                    <form action={archiveSeriesAction.bind(null, series.id)}>
                      <SubmitButton pendingText={t("teacherHome.processing")} className={small}>{t("teacherHome.end")}</SubmitButton>
                    </form>
                  )}
                  <form action={carryOverSeriesAction.bind(null, series.id)} className="flex items-center gap-1">
                    <label htmlFor={`carry-${series.id}`} className="sr-only">{t("teacherHome.carryYear")}</label>
                    <input id={`carry-${series.id}`} name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year + 1} className="w-20 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs" />
                    <SubmitButton pendingText={t("teacherHome.copying")} className={small}>{t("teacherHome.carryOver")}</SubmitButton>
                  </form>
                  {hasRecords ? (
                    <Link href={`/series/${series.id}#manage`} className="text-xs text-ink-muted underline underline-offset-2">
                      {t("teacherHome.hasRecords")}
                    </Link>
                  ) : (
                    <details className="inline-block">
                      <summary className="cursor-pointer text-xs text-danger underline underline-offset-2">{t("teacherHome.deleteSummary")}</summary>
                      <form action={deleteSeriesAction.bind(null, series.id)} className="mt-2 rounded-md border border-danger p-2 text-xs">
                        <p className="text-ink-muted">{t("teacherHome.deleteWarn")}</p>
                        <SubmitButton pendingText={t("teacherHome.deleting")} className="mt-2 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          {t("teacherHome.deleteConfirm")}
                        </SubmitButton>
                      </form>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
          {seriesList.length === 0 && <li className="text-sm text-ink-muted">{t("teacherHome.nothingToDo")}</li>}
        </ul>
      </section>

      {showAdminLink && (
        <section id="admin-menu" aria-labelledby="admin-h" className="mt-12 rounded-lg border border-line bg-surface p-5">
          <h2 id="admin-h" className={h2Class}>
            {t("teacherHome.adminMenu")}
            <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line">{t("teacherHome.adminOnly")}</span>
          </h2>
          <p className={introClass}>{t("teacherHome.adminLead")}</p>
          <ul className="mt-4 space-y-2">
            <li>
              <Link href="/admin/teachers" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-raised px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">{t("teacherHome.teacherApproval")}</span>
                <span className={pendingTeacherCount ? "font-medium text-warn" : "text-ink-muted"}>
                  {pendingTeacherCount ? t("teacherHome.approvalPending", { n: pendingTeacherCount }) : t("teacherHome.approvalNone")}
                </span>
              </Link>
            </li>
            <li>
              <Link href="/admin/organizations" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-raised px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">{t("teacherHome.orgAdmin")}</span>
                <span className="text-ink-muted">{t("teacherHome.orgKinds")}</span>
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
