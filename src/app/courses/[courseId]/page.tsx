import { LESSON_STATUS_CLASSES, lessonStatus, lessonStatusLabel } from "@/lib/courses/lesson-status";
import { getT } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/translate";
import Link from "next/link";
import { CANONICAL_STAGES } from "@/lib/inquiry/stages";
import { StepNumber } from "@/components/step-number";
import { notFound } from "next/navigation";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { lessonName, loadLessonCrumbs } from "@/lib/courses/series";
import {
  uploadMaterialAction,
  generateMaterialRagAction,
  generateAllPendingRagAction,
  shareMaterialAction,
  unshareMaterialAction,
  updateAutoDiscussionSettingsAction,
  updateCourseSettingsAction,
  startStudentViewAction,
  setLessonClosedAction,
  setLessonReleasedAction,
  renameLessonAction,
} from "./actions";
import { TEMPO_OPTIONS } from "@/lib/discussion-tempo";
import {
  DISCUSSION_STYLES,
  LEARNER_LEVELS,
  TIME_LIMIT_OPTIONS,
  TIME_LIMIT_POLICIES,
  REASONING_DEPTHS,
} from "@/lib/courses/settings";
import { LIVELINESS } from "@/lib/ai/persona-scene";

const KIND_KEYS = ["syllabus", "pdf", "word", "ppt", "text", "video_subtitle", "url"] as const;
const RAG_STATUS_KEYS = ["pending", "processing", "done", "failed"] as const;

const RAG_STATUS_STYLES: Record<string, string> = {
  pending: "bg-surface text-ink-muted",
  processing: "bg-warn-soft text-warn",
  done: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
};

function MenuCard({
  href,
  title,
  description,
  badge,
  step,
}: {
  href: string;
  title: string;
  description: string;
  badge?: string;
  step?: number;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-surface-raised"
    >
      <span className="flex items-center text-sm font-medium text-ink">
        {step !== undefined && <StepNumber n={step} />}
        {title}
        {badge && (
          <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{badge}</span>
        )}
      </span>
      <span className="text-xs leading-5 text-ink-muted">{description}</span>
    </Link>
  );
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();
  const kindLabel = (kind: string) => ((KIND_KEYS as readonly string[]).includes(kind) ? t(`materialKinds.${kind}` as DictKey) : kind);

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select(
      "id, title, subject, owner_teacher_id, series_id, lesson_no, released, closed_at, auto_discussion_tempo_seconds, auto_discussion_affects_evaluation, objective, learner_level, discussion_style, ai_member_count, discussion_liveliness, reasoning_depth, time_limit_minutes, time_limit_policy, time_limit_affects_evaluation, ai_close_suggestion, expected_stage_key",
    )
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const crumbs = await loadLessonCrumbs(admin, courseId, lang);
  const lessonState = lessonStatus({ released: course.released, closed_at: course.closed_at ?? null }, crumbs?.endedBy === "series");

  const { data: materials } = await admin
    .from("course_materials")
    .select("id, kind, title, source_url, rag_status, rag_error, shared_at, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const { data: chunkRows } = await admin
    .from("material_chunks")
    .select("material_id")
    .eq("course_id", courseId);

  const chunkCountByMaterial = new Map<string, number>();
  for (const row of chunkRows ?? []) {
    if (!row.material_id) continue;
    chunkCountByMaterial.set(row.material_id, (chunkCountByMaterial.get(row.material_id) ?? 0) + 1);
  }

  const pendingCount = (materials ?? []).filter(
    (m) => m.rag_status === "pending" || m.rag_status === "failed",
  ).length;

  const boundUploadAction = uploadMaterialAction.bind(null, courseId);
  const boundGenerateAllAction = generateAllPendingRagAction.bind(null, courseId);
  const boundUpdateAutoDiscussionAction = updateAutoDiscussionSettingsAction.bind(null, courseId);
  const boundUpdateCourseSettingsAction = updateCourseSettingsAction.bind(null, courseId);
  const boundStartStudentViewAction = startStudentViewAction.bind(null, courseId);
  const canViewAsStudent = await isAdmin(admin, user.id);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={crumbs?.teacherTrail.slice(0, 2) ?? [{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={lessonName(course.lesson_no, course.title, lang)} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{lessonName(course.lesson_no, course.title, lang)}</h1>
      {crumbs && <p className="mt-1 text-sm text-ink-muted">{t("lessonAdmin.seriesLesson", { title: crumbs.seriesTitle })}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line p-4">
        <p className="text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LESSON_STATUS_CLASSES[lessonState]}`}>{lessonStatusLabel(t, lessonState)}</span>
          <span className="ml-2 text-xs text-ink-muted">
            {lessonState === "preparing"
              ? t("lessonAdmin.hintPreparing")
              : lessonState === "open"
                ? t("lessonAdmin.hintOpen")
                : crumbs?.endedBy === "series"
                  ? t("lessonAdmin.hintEndedSeries")
                  : t("lessonAdmin.hintEnded")}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {lessonState === "preparing" && (
            <form action={setLessonReleasedAction.bind(null, courseId, true)}>
              <SubmitButton pendingText={t("lessonAdmin.changing")} className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                {t("lessonAdmin.release")}
              </SubmitButton>
            </form>
          )}
          {lessonState === "open" && (
            <>
              <form action={setLessonReleasedAction.bind(null, courseId, false)}>
                <button type="submit" className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink">{t("lessonAdmin.backToPreparing")}</button>
              </form>
              <form action={setLessonClosedAction.bind(null, courseId, true)}>
                <SubmitButton pendingText={t("lessonAdmin.changing")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  {t("lessonAdmin.endLesson")}
                </SubmitButton>
              </form>
            </>
          )}
          {lessonState === "closed" && crumbs?.endedBy !== "series" && (
            <form action={setLessonClosedAction.bind(null, courseId, false)}>
              <SubmitButton pendingText={t("lessonAdmin.changing")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                {t("lessonAdmin.reopen")}
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">{t("lessonAdmin.renameSummary")}</summary>
        <form action={renameLessonAction.bind(null, courseId)} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="lesson-title" className="sr-only">{t("lessonAdmin.lessonNameLabel")}</label>
          <input
            id="lesson-title"
            name="title"
            defaultValue={course.title}
            maxLength={80}
            required
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
          />
          <SubmitButton pendingText={t("lessonAdmin.saving")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
            {t("lessonAdmin.save")}
          </SubmitButton>
        </form>
      </details>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("lessonAdmin.prepHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("lessonAdmin.prepLead")}</p>
      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink"><StepNumber n={1} />{t("lessonAdmin.settings")}</summary>
      <form action={boundUpdateCourseSettingsAction} className="mt-4 space-y-4">
        <div>
          <p className="mt-1 text-sm text-ink-muted">
            {t("lessonAdmin.settingsLead")}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="course-objective" className="text-sm font-medium text-ink">
            {t("lessonAdmin.objective")}
          </label>
          <textarea
            id="course-objective"
            name="objective"
            rows={3}
            maxLength={1000}
            defaultValue={course.objective ?? ""}
            placeholder={t("lessonAdmin.objectivePlaceholder")}
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-level" className="text-sm font-medium text-ink">
              {t("lessonAdmin.level")}
            </label>
            <select
              id="course-level"
              name="learnerLevel"
              defaultValue={course.learner_level ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">{t("lessonAdmin.unspecified")}</option>
              {LEARNER_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`lessonSettings.level${LEARNER_LEVELS.indexOf(level)}` as DictKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-style" className="text-sm font-medium text-ink">
              {t("lessonAdmin.style")}
            </label>
            <select
              id="course-style"
              name="discussionStyle"
              defaultValue={course.discussion_style ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">{t("lessonAdmin.unspecified")}</option>
              {Object.entries(DISCUSSION_STYLES).map(([key, style]) => (
                <option key={key} value={key}>
                  {t(`lessonSettings.style_${key}` as DictKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-expected-stage" className="text-sm font-medium text-ink">
              {t("lessonAdmin.expectedStage")}
            </label>
            <select
              id="course-expected-stage"
              name="expectedStageKey"
              defaultValue={course.expected_stage_key ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">{t("lessonAdmin.unspecified")}</option>
              {CANONICAL_STAGES.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {t(`stages.${stage.key}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="w-32 space-y-1">
            <label htmlFor="course-ai-count" className="text-sm font-medium text-ink">
              {t("lessonAdmin.aiCount")}
            </label>
            <select
              id="course-ai-count"
              name="aiMemberCount"
              defaultValue={course.ai_member_count?.toString() ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">{t("lessonAdmin.unspecified")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t("lessonAdmin.nPeople", { n })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1 border-t border-line-soft pt-4">
          <label htmlFor="course-liveliness" className="text-sm font-medium text-ink">
            {t("lessonAdmin.liveliness")}
          </label>
          <select
            id="course-liveliness"
            name="discussionLiveliness"
            defaultValue={course.discussion_liveliness ?? "normal"}
            className="w-full max-w-xs rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          >
            {Object.entries(LIVELINESS).map(([key, v]) => (
              <option key={key} value={key}>
                {t(`lessonSettings.lively_${key}` as DictKey)}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            {t("lessonAdmin.livelinessHelp")}
          </p>
        </div>

        <div className="space-y-1 border-t border-line-soft pt-4">
          <label htmlFor="course-reasoning" className="text-sm font-medium text-ink">
            {t("lessonAdmin.reasoning")}
          </label>
          <select
            id="course-reasoning"
            name="reasoningDepth"
            defaultValue={course.reasoning_depth ?? "standard"}
            className="w-full max-w-md rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          >
            {Object.entries(REASONING_DEPTHS).map(([key]) => (
              <option key={key} value={key}>
                {t(`lessonSettings.reasoning_${key}` as DictKey)}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            {t("lessonAdmin.reasoningHelp")}
          </p>
        </div>

        <div className="space-y-3 border-t border-line-soft pt-4">
          <h3 className="text-xs font-medium text-ink-faint">{t("lessonAdmin.endingHeading")}</h3>
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[10rem] space-y-1">
              <label htmlFor="course-time-limit" className="text-sm font-medium text-ink">
                {t("lessonAdmin.timeLimit")}
              </label>
              <select
                id="course-time-limit"
                name="timeLimitMinutes"
                defaultValue={course.time_limit_minutes?.toString() ?? ""}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
              >
                <option value="">{t("lessonAdmin.noLimit")}</option>
                {TIME_LIMIT_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {t("lessonAdmin.minutes", { m })}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="course-time-policy" className="text-sm font-medium text-ink">
                {t("lessonAdmin.whenOver")}
              </label>
              <select
                id="course-time-policy"
                name="timeLimitPolicy"
                defaultValue={course.time_limit_policy ?? "soft"}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
              >
                {Object.entries(TIME_LIMIT_POLICIES).map(([key]) => (
                  <option key={key} value={key}>
                    {t(`lessonSettings.policy_${key}` as DictKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            {t("lessonAdmin.timeLimitHelp")}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="timeLimitAffectsEvaluation"
              defaultChecked={course.time_limit_affects_evaluation}
              className="mt-1"
            />
            <span>
              {t("lessonAdmin.affectsEval")}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="aiCloseSuggestion"
              defaultChecked={course.ai_close_suggestion}
              className="mt-1"
            />
            <span>
              {t("lessonAdmin.aiCloseSuggest")}
            </span>
          </label>
        </div>

        <SubmitButton
          pendingText={t("lessonAdmin.saving")}
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
        >
          {t("lessonAdmin.saveSettings")}
        </SubmitButton>
      </form>
      </details>

      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          <StepNumber n={2} />
          {t("lessonAdmin.materials")}
          <span className="ml-2 text-xs font-normal text-ink-muted">{t("lessonAdmin.countItems", { n: (materials ?? []).length })}</span>
        </summary>
        <p className="mt-2 text-sm text-ink-muted">
          {t("lessonAdmin.materialsLead")}
        </p>
        <div className="mt-3">
      <form
        action={boundUploadAction}
        className="space-y-3 rounded-md border border-line p-4"
      >
        <h3 className="text-xs font-medium text-ink-faint">{t("lessonAdmin.addMaterial")}</h3>

        <label htmlFor="material-kind" className="sr-only">
          {t("lessonAdmin.materialKind")}
        </label>
        <select
          id="material-kind"
          name="kind"
          required
          defaultValue=""
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        >
          <option value="" disabled>
            {t("lessonAdmin.pickKind")}
          </option>
          {KIND_KEYS.map((value) => (
            <option key={value} value={value}>
              {kindLabel(value)}
            </option>
          ))}
        </select>

        <label htmlFor="material-title" className="sr-only">
          {t("lessonAdmin.materialTitle")}
        </label>
        <input
          id="material-title"
          name="title"
          placeholder={t("lessonAdmin.materialTitle")}
          required
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />

        <label htmlFor="material-url" className="sr-only">
          URL
        </label>
        <input
          id="material-url"
          name="url"
          placeholder={t("lessonAdmin.urlPlaceholder")}
          type="url"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />

        <label htmlFor="material-file" className="sr-only">
          {t("lessonAdmin.fileLabel")}
        </label>
        <input
          id="material-file"
          name="file"
          type="file"
          className="w-full text-sm text-ink"
        />
        <p className="text-xs text-ink-muted">
          {t("lessonAdmin.fileHelp")}
        </p>

        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          {t("lessonAdmin.add")}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-faint">{t("lessonAdmin.registered")}</h3>
        {pendingCount > 0 && (
          <form action={boundGenerateAllAction}>
            <SubmitButton
              pendingText={t("lessonAdmin.generating")}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
            >
              {t("lessonAdmin.generatePending", { n: pendingCount })}
            </SubmitButton>
          </form>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {(materials ?? []).map((material) => {
          const boundGenerateOneAction = generateMaterialRagAction.bind(null, courseId, material.id);
          const boundShareAction = shareMaterialAction.bind(null, courseId, material.id);
          const boundUnshareAction = unshareMaterialAction.bind(null, courseId, material.id);
          const chunkCount = chunkCountByMaterial.get(material.id) ?? 0;
          const statusLabel = (RAG_STATUS_KEYS as readonly string[]).includes(material.rag_status) ? t(`materialKinds.rag_${material.rag_status}` as DictKey) : material.rag_status;
          const statusStyle =
            RAG_STATUS_STYLES[material.rag_status] ??
            "bg-surface text-ink-muted";

          return (
            <li
              key={material.id}
              className="rounded-md border border-line px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{material.title}</span>
                  <span className="ml-2 text-ink-muted">
                    [{kindLabel(material.kind)}]
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle}`}>
                    {statusLabel}
                    {material.rag_status === "done" && chunkCount > 0 && t("lessonAdmin.chunks", { n: chunkCount })}
                  </span>
                  <form action={boundGenerateOneAction}>
                    <SubmitButton
                      pendingText={t("lessonAdmin.generating")}
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                    >
                      {material.rag_status === "done" ? t("lessonAdmin.regenerate") : t("lessonAdmin.generate")}
                    </SubmitButton>
                  </form>
                </div>
              </div>
              {material.rag_status === "failed" && material.rag_error && (
                <p className="mt-2 text-xs text-danger">{material.rag_error}</p>
              )}
              {material.kind === "syllabus" && (
                <div className="mt-2 flex items-center gap-2">
                  {material.shared_at ? (
                    <>
                      <span className="text-xs text-accent">
                        {t("lessonAdmin.sharedNow")}
                      </span>
                      <form action={boundUnshareAction}>
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                        >
                          {t("lessonAdmin.unshare")}
                        </button>
                      </form>
                    </>
                  ) : (
                    <form action={boundShareAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                      >
                        {t("lessonAdmin.share")}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {(!materials || materials.length === 0) && (
          <li className="text-sm text-ink-muted">{t("lessonAdmin.noMaterials")}</li>
        )}
      </ul>
        </div>
      </details>
      <nav aria-label={t("lessonAdmin.prepMenu")} className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        <MenuCard
          href={`/courses/${courseId}/personas`}
          title={t("lessonAdmin.personas")}
          step={3}
          description={t("lessonAdmin.personasDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/flow`}
          title={t("lessonAdmin.flow")}
          step={4}
          description={t("lessonAdmin.flowDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/criteria`}
          title={t("lessonAdmin.criteria")}
          step={5}
          description={t("lessonAdmin.criteriaDesc")}
        />
      </nav>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("lessonAdmin.learnerHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {t("lessonAdmin.enrollLead")}
          <Link href={`/series/${course.series_id}`} className="ml-1 text-accent underline underline-offset-2 hover:text-accent-dark">{t("lessonAdmin.openEnroll")}</Link>
        </p>
      <details className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">{t("lessonAdmin.tempoSummary")}</summary>
        <p className="mt-1 text-sm text-ink-muted">
          {t("lessonAdmin.tempoLead")}
        </p>
        <form action={boundUpdateAutoDiscussionAction} className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="block text-ink-muted">{t("lessonAdmin.defaultTempo")}</span>
            <select
              name="tempoSeconds"
              defaultValue={String(course.auto_discussion_tempo_seconds ?? 0)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
            >
              {TEMPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(`tempo.v${opt.value}` as DictKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="affectsEvaluation"
              defaultChecked={course.auto_discussion_affects_evaluation}
            />
            {t("lessonAdmin.tempoAffects")}
          </label>
          <button
            type="submit"
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
          >
            {t("lessonAdmin.saveShort")}
          </button>
        </form>
      </details>

      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("lessonAdmin.reviewHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">{t("lessonAdmin.reviewLead")}</p>
      <nav aria-label={t("lessonAdmin.reviewMenu")} className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        <MenuCard
          href={`/courses/${courseId}/dashboard`}
          title={t("lessonAdmin.dashboard")}
          description={t("lessonAdmin.dashboardDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/submissions`}
          title={t("lessonAdmin.submissions")}
          description={t("lessonAdmin.submissionsDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/students`}
          title={t("lessonAdmin.students")}
          description={t("lessonAdmin.studentsDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/conformity`}
          title={t("lessonAdmin.conformity")}
          description={t("lessonAdmin.conformityDesc")}
        />
        <MenuCard
          href={`/courses/${courseId}/audit`}
          title={t("lessonAdmin.audit")}
          description={t("lessonAdmin.auditDesc")}
        />
        {canViewAsStudent && (
          <form action={boundStartStudentViewAction} className="contents">
            <button
              type="submit"
              className="flex flex-col gap-1 rounded-lg border border-dashed border-line-strong p-4 text-left transition-colors hover:border-accent hover:bg-surface"
            >
              <span className="text-sm font-medium text-ink">{t("lessonAdmin.viewAs")}</span>
              <span className="text-xs leading-5 text-ink-muted">
                {t("lessonAdmin.viewAsDesc")}
              </span>
            </button>
          </form>
        )}
      </nav>
      <p className="mt-2 text-xs text-ink-faint">
        {t("lessonAdmin.learnersOpen")}
      </p>
      </section>

      <BackLink href={crumbs ? `/series/${crumbs.seriesId}` : "/courses"} label={crumbs?.seriesTitle ?? t("lessonCrumbs.courseList")} />
    </div>
  );
}
