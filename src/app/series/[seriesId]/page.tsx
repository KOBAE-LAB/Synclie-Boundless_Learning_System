import { LESSON_STATUS_CLASSES, lessonStatus, lessonStatusLabel } from "@/lib/courses/lesson-status";
import { getT } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { lessonName, seriesLabel } from "@/lib/courses/series";
import { seriesHasLearnerRecords, summarizeSeriesRecords } from "@/lib/courses/series-admin";
import {
  approveEnrollmentAction,
  archiveSeriesAction,
  carryOverSeriesAction,
  clearEnrollmentsAction,
  copyEnrollmentsAction,
  createLessonAction,
  deleteSeriesAction,
  forceDeleteSeriesAction,
  unarchiveSeriesAction,
  regenerateJoinCodeAction,
  registerStudentAction,
  removeEnrollmentAction,
  updateSeriesAction,
} from "./actions";
import { GroupsSection } from "./groups-section";

// 教科・科目(科目・講座)のページ。担当教師が、授業回(第1回、第2回…)を重ね、履修登録(授業コード・承認)を管理する。
// 資料・ペルソナ・学習の流れ・議論は、授業回ごとに持つ。

export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ group_error?: string }>;
}) {
  const { seriesId } = await params;
  const { group_error: groupError } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();
  const admin = createAdminClient();

  const { data: series } = await admin
    .from("course_series")
    .select("id, title, subject, join_code, owner_teacher_id, planned_lessons, fiscal_year, archived_at, kind")
    .eq("id", seriesId)
    .maybeSingle();
  if (!series || series.owner_teacher_id !== user.id) {
    notFound();
  }

  const [{ data: lessons }, { data: enrollmentRows }] = await Promise.all([
    admin
      .from("courses")
      .select("id, title, lesson_no, mode, released, closed_at")
      .eq("series_id", seriesId)
      .order("lesson_no", { ascending: true }),
    admin
      .from("series_enrollments")
      .select("student_id, status, created_at")
      .eq("series_id", seriesId)
      .order("created_at", { ascending: true }),
  ]);

  const enrolledStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "approved").map((e) => e.student_id);
  const pendingStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "pending").map((e) => e.student_id);
  const allEnrollmentStudentIds = (enrollmentRows ?? []).map((e) => e.student_id);
  const { data: enrolledProfiles } =
    allEnrollmentStudentIds.length > 0
      ? await admin.from("profiles").select("id, display_name, email").in("id", allEnrollmentStudentIds)
      : { data: [] };
  const profileById = new Map((enrolledProfiles ?? []).map((p) => [p.id, p]));

  const canPurge = await isAdmin(admin, user.id);
  const hasRecords = await seriesHasLearnerRecords(admin, seriesId);
  const recordSummary = hasRecords ? await summarizeSeriesRecords(admin, seriesId) : null;
  const { data: otherSeries } = await admin
    .from("course_series")
    .select("id, title, fiscal_year")
    .eq("owner_teacher_id", user.id)
    .is("archived_at", null)
    .neq("id", seriesId)
    .order("created_at", { ascending: false });
  const lessonCount = (lessons ?? []).length;

  const boundRegenerateJoinCodeAction = regenerateJoinCodeAction.bind(null, seriesId);
  const boundRegisterStudentAction = registerStudentAction.bind(null, seriesId);
  const nextLessonNo = Math.max(0, ...(lessons ?? []).map((l) => l.lesson_no)) + 1;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={series.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{seriesLabel(series.title, series.planned_lessons, lang)}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t(`studyMode.${series.kind === "inquiry" ? "inquiry" : "standard"}`)}・
        {t("teacherHome.yearOption", { y: series.fiscal_year })}{series.subject ? `・${series.subject}` : ""}
        {series.planned_lessons ? t("seriesAdmin.created", { n: lessonCount, total: series.planned_lessons }) : t("seriesAdmin.lessonsOnly", { n: lessonCount })}
      </p>
      {series.archived_at && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>{t("seriesAdmin.endedBanner")}</span>
          <form action={unarchiveSeriesAction.bind(null, seriesId)}>
            <SubmitButton pendingText={t("seriesAdmin.reopening")} className="rounded-md border border-warn px-3 py-1.5 text-xs font-medium hover:bg-surface-raised disabled:opacity-50">
              {t("seriesAdmin.reopen")}
            </SubmitButton>
          </form>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">{t("seriesAdmin.editSummary")}</summary>
        <form action={updateSeriesAction.bind(null, seriesId)} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="series-title" className="sr-only">{t("seriesAdmin.subjectName")}</label>
          <input id="series-title" name="title" defaultValue={series.title} required maxLength={80} className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-subject" className="sr-only">{t("seriesAdmin.noteLabel")}</label>
          <input id="series-subject" name="subject" defaultValue={series.subject ?? ""} placeholder={t("seriesAdmin.notePlaceholder")} maxLength={40} className="w-48 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-planned" className="sr-only">{t("seriesAdmin.totalLabel")}</label>
          <input id="series-planned" name="plannedLessons" type="number" min={1} max={60} defaultValue={series.planned_lessons ?? ""} placeholder={t("seriesAdmin.totalPlaceholder")} className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-year" className="sr-only">{t("seriesAdmin.yearLabel")}</label>
          <input id="series-year" name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year} className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <SubmitButton pendingText={t("seriesAdmin.saving")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">{t("seriesAdmin.save")}</SubmitButton>
        </form>
      </details>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("seriesAdmin.lessonsHeading", { n: (lessons ?? []).length })}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("seriesAdmin.lessonsLead")}</p>
        <ul className="mt-3 space-y-2">
          {(lessons ?? []).map((lesson) => (
            <li key={lesson.id}>
              <Link href={`/courses/${lesson.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">
                  {lessonName(lesson.lesson_no, lesson.title, lang)}
                  <span className="ml-2 text-xs font-normal text-ink-faint">[{lesson.mode === "solo_study" ? t("seriesAdmin.modeSolo") : lesson.mode === "group" ? t("seriesAdmin.modeGroup") : lesson.mode}]</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LESSON_STATUS_CLASSES[lessonStatus(lesson, !!series.archived_at)]}`}>
                  {lessonStatusLabel(t, lessonStatus(lesson, !!series.archived_at))}
                </span>
              </Link>
            </li>
          ))}
          {(lessons ?? []).length === 0 && <li className="text-sm text-ink-muted">{t("seriesAdmin.noLessons")}</li>}
        </ul>

        {!series.archived_at && (
        <details open={(lessons ?? []).length === 0} className="mt-4 rounded-lg border border-line p-5">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            {t("seriesAdmin.createLesson", { n: nextLessonNo, planned: series.planned_lessons ? t("seriesAdmin.ofTotal", { total: series.planned_lessons }) : "" })}
          </summary>
          <form action={createLessonAction.bind(null, seriesId)} className="mt-4 space-y-3">
            <label htmlFor="lesson-new-title" className="sr-only">{t("seriesAdmin.lessonNameLabel")}</label>
            <input
              id="lesson-new-title"
              name="title"
              placeholder={t("seriesAdmin.lessonNamePlaceholder")}
              required
              maxLength={80}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <label htmlFor="lesson-new-mode" className="sr-only">{t("seriesAdmin.formatLabel")}</label>
            <select id="lesson-new-mode" name="mode" defaultValue="group" className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm">
              <option value="group">{t("seriesAdmin.formatGroup")}</option>
              <option value="solo_study">{t("seriesAdmin.formatSolo")}</option>
            </select>
            {lessonCount > 0 && (
              <label className="flex items-start gap-2 text-sm text-ink-muted">
                <input type="checkbox" name="inherit" defaultChecked className="mt-1" />
                <span>{t("seriesAdmin.inherit")}</span>
              </label>
            )}
            <SubmitButton pendingText={t("seriesAdmin.creating")} className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
              {t("seriesAdmin.create")}
            </SubmitButton>
          </form>
        </details>
        )}
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("seriesAdmin.enrollHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("seriesAdmin.enrollLead")}</p>
      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {t("seriesAdmin.enrollSummary")}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {t("seriesAdmin.enrolledCount", { n: enrolledStudentIds.length, pending: pendingStudentIds.length > 0 ? t("seriesAdmin.pendingSuffix", { n: pendingStudentIds.length }) : "" })}
          </span>
        </summary>
        <p className="mt-1 text-sm text-ink-muted">
          {t("seriesAdmin.codeLead")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-md border border-line bg-surface-raised px-3 py-1.5 font-mono text-lg tracking-widest text-ink">
            {series.join_code}
          </span>
          <form action={boundRegenerateJoinCodeAction}>
            <button
              type="submit"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              {t("seriesAdmin.regenCode")}
            </button>
          </form>
        </div>

        {pendingStudentIds.length > 0 && (
          <div className="mt-4 rounded-md border border-warn bg-warn-soft p-3">
            <h3 className="text-xs font-medium text-warn">{t("seriesAdmin.pendingHeading", { n: pendingStudentIds.length })}</h3>
            <ul className="mt-2 space-y-1">
              {pendingStudentIds.map((studentId) => {
                const profile = profileById.get(studentId);
                const boundApproveAction = approveEnrollmentAction.bind(null, seriesId, studentId);
                const boundRejectAction = removeEnrollmentAction.bind(null, seriesId, studentId);
                return (
                  <li
                    key={studentId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="text-ink">{profile?.display_name || profile?.email || studentId}</span>
                    <span className="flex items-center gap-2">
                      <form action={boundApproveAction}>
                        <button
                          type="submit"
                          className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover"
                        >
                          {t("seriesAdmin.approve")}
                        </button>
                      </form>
                      <form action={boundRejectAction}>
                        <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">
                          {t("seriesAdmin.reject")}
                        </button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <h3 className="mt-4 text-xs font-medium text-ink-faint">
          {t("seriesAdmin.enrolledHeading", { n: enrolledStudentIds.length })}
        </h3>
        <ul className="mt-2 space-y-1">
          {enrolledStudentIds.map((studentId) => {
            const profile = profileById.get(studentId);
            const boundRemoveAction = removeEnrollmentAction.bind(null, seriesId, studentId);
            return (
              <li
                key={studentId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              >
                <span className="text-ink-muted">{profile?.display_name || profile?.email || studentId}</span>
                <form action={boundRemoveAction}>
                  <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">
                    {t("seriesAdmin.removeEnrollment")}
                  </button>
                </form>
              </li>
            );
          })}
          {enrolledStudentIds.length === 0 && (
            <li className="text-sm text-ink-muted">{t("seriesAdmin.noEnrolled")}</li>
          )}
        </ul>

        <form action={boundRegisterStudentAction} className="mt-5 space-y-2 border-t border-line-soft pt-4">
          <h3 className="text-xs font-medium text-ink-faint">{t("seriesAdmin.registerHeading")}</h3>
          <p className="text-xs text-ink-muted">
            {t("seriesAdmin.registerLead")}
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="reg-name">{t("seriesAdmin.regName")}</label>
            <input
              id="reg-name"
              name="name"
              required
              placeholder={t("seriesAdmin.regName")}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-email">{t("seriesAdmin.regEmail")}</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              required
              placeholder={t("seriesAdmin.regEmail")}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-password">{t("seriesAdmin.regPassword")}</label>
            <input
              id="reg-password"
              name="password"
              type="text"
              minLength={10}
              autoComplete="off"
              placeholder={t("seriesAdmin.regPassword")}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
          </div>
          <SubmitButton
            pendingText={t("seriesAdmin.registering")}
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {t("seriesAdmin.register")}
          </SubmitButton>
        </form>
      </details>


      </section>


      {series.kind === "inquiry" && (
        <GroupsSection
          admin={admin}
          seriesId={seriesId}
          archived={Boolean(series.archived_at)}
          enrolledStudentIds={enrolledStudentIds}
          nameOf={(id) => {
            const p = profileById.get(id);
            return p?.display_name || p?.email || t("seriesAdmin.notEnrolledLearner");
          }}
          error={groupError}
        />
      )}

      <section className="mt-10" id="manage">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("seriesAdmin.manageHeading")}</h2>
        <div className="mt-4 space-y-3">
          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">{t("seriesAdmin.carrySummary")}</summary>
            <p className="mt-2 text-sm text-ink-muted">
              {t("seriesAdmin.carryLead")}
            </p>
            <form action={carryOverSeriesAction.bind(null, seriesId)} className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="carry-year" className="text-xs text-ink-muted">{t("seriesAdmin.newYear")}</label>
              <input id="carry-year" name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year + 1} className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
              <SubmitButton pendingText={t("seriesAdmin.copying")} className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                {t("seriesAdmin.carryDo")}
              </SubmitButton>
            </form>
          </details>

          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">{t("seriesAdmin.bulkSummary")}</summary>
            <p className="mt-2 text-sm text-ink-muted">{t("seriesAdmin.bulkLead")}</p>
            {(otherSeries ?? []).length > 0 ? (
              <form action={copyEnrollmentsAction.bind(null, seriesId)} className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor="copy-target" className="text-xs text-ink-muted">{t("seriesAdmin.copyTo", { n: enrolledStudentIds.length })}</label>
                <select id="copy-target" name="targetSeriesId" required defaultValue="" className="min-w-0 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
                  <option value="" disabled>{t("seriesAdmin.pickSubject")}</option>
                  {(otherSeries ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{t("seriesAdmin.optionYear", { title: o.title, y: o.fiscal_year })}</option>
                  ))}
                </select>
                <SubmitButton pendingText={t("seriesAdmin.registering")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  {t("seriesAdmin.register")}
                </SubmitButton>
              </form>
            ) : (
              <p className="mt-3 text-xs text-ink-faint">{t("seriesAdmin.noTargets")}</p>
            )}
            <form action={clearEnrollmentsAction.bind(null, seriesId)} className="mt-3 border-t border-line-soft pt-3">
              <p className="text-xs text-ink-muted">{t("seriesAdmin.clearLead")}</p>
              <SubmitButton pendingText={t("seriesAdmin.clearing")} className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-danger hover:bg-surface disabled:opacity-50">
                {t("seriesAdmin.clearAll")}
              </SubmitButton>
            </form>
          </details>

          {!series.archived_at && (
            <details className="rounded-lg border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">{t("seriesAdmin.endSummary")}</summary>
              <p className="mt-2 text-sm text-ink-muted">
                {t("seriesAdmin.endLead")}
              </p>
              <form action={archiveSeriesAction.bind(null, seriesId)} className="mt-3">
                <SubmitButton pendingText={t("seriesAdmin.processing")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  {t("seriesAdmin.end")}
                </SubmitButton>
              </form>
            </details>
          )}

          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-danger">{t("seriesAdmin.deleteSummary")}</summary>
            {hasRecords ? (
              <div className="mt-2 space-y-3 text-sm text-ink-muted">
                <p>
                  {t("seriesAdmin.recDeleteA")}<b>{t("seriesAdmin.irreversible")}</b>
                  {t("seriesAdmin.recDeleteB", { n: recordSummary?.learners ?? 0 })}
                </p>
                <form action={deleteSeriesAction.bind(null, seriesId)}>
                  <SubmitButton pendingText={t("seriesAdmin.deleting")} className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {t("seriesAdmin.deleteStructure")}
                  </SubmitButton>
                </form>
                {canPurge ? (
                  <div className="rounded-md border border-danger p-3">
                    <p className="font-medium text-danger">{t("seriesAdmin.purgeHeading")}</p>
                    <p className="mt-1">
                      {t("seriesAdmin.purgeA", { n: recordSummary?.learners ?? 0, s: recordSummary?.sessions ?? 0, x: recordSummary?.submissions ?? 0 })}
                      <b>{t("seriesAdmin.irreversible")}</b>
                    </p>
                    {series.archived_at ? (
                      <form action={forceDeleteSeriesAction.bind(null, seriesId)} className="mt-3 space-y-2">
                        <label htmlFor="force-confirm" className="block text-xs text-ink-muted">
                          {t("seriesAdmin.confirmName", { title: series.title })}
                        </label>
                        <input id="force-confirm" name="confirmTitle" required autoComplete="off" className="w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
                        <SubmitButton pendingText={t("seriesAdmin.deleting")} className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          {t("seriesAdmin.purgeAll")}
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="mt-2 text-xs text-warn">{t("seriesAdmin.endFirst")}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint">{t("seriesAdmin.onlyAdminPurge")}</p>
                )}
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-muted">
                  {t("seriesAdmin.deleteAllA")}<b>{t("seriesAdmin.irreversible")}</b>
                </p>
                <form action={deleteSeriesAction.bind(null, seriesId)} className="mt-3">
                  <SubmitButton pendingText={t("seriesAdmin.deleting")} className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    {t("seriesAdmin.deleteAll")}
                  </SubmitButton>
                </form>
              </>
            )}
          </details>
        </div>
      </section>

      <BackLink href="/courses" label={t("lessonCrumbs.courseList")} />
    </div>
  );
}
