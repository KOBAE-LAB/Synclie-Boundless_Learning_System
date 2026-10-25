import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { updateFeedbackAction, sendGradeToLmsAction, saveTeacherAssessmentAction } from "./actions";
import { ratingLabel, readAssessment } from "@/lib/portfolio/assessment";
import { formatDateTime, getT } from "@/lib/i18n/server";
import { SubmitButton } from "@/components/submit-button";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

interface SubmissionRow {
  id: string;
  student_id: string;
  content: string;
  created_at: string;
  feedback_status: string;
  feedback_error: string | null;
}

interface JudgmentRow {
  submission_id: string;
  logic_structure: number;
  evidence_quality: number;
  rebuttal_response: number;
  summary_comment: string;
}

interface FeedbackRow {
  id: string;
  submission_id: string;
  criteria_label: string;
  good_points: string;
  next_question: string;
  material_reference: string;
}

interface ReflectionRow {
  submission_id: string;
  what_learned: string;
  what_confused: string;
  next_goal: string;
}

const inputClassName =
  "w-full rounded-md border border-line px-2 py-1.5 text-xs bg-surface-raised";

export default async function SubmissionsReviewPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { data: submissionRows } = await admin
    .from("submissions")
    .select("id, student_id, content, created_at, feedback_status, feedback_error")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  const submissions = (submissionRows ?? []) as SubmissionRow[];

  const studentNames = new Map<string, string>();
  const feedbackBySubmission = new Map<string, FeedbackRow[]>();
  const reflectionBySubmission = new Map<string, ReflectionRow>();
  const judgmentBySubmission = new Map<string, JudgmentRow>();
  const teacherAssessmentBySubmission = new Map<string, ReturnType<typeof readAssessment>>();

  if (submissions.length > 0) {
    const studentIds = [...new Set(submissions.map((s) => s.student_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .in("id", studentIds);
    for (const profile of profiles ?? []) {
      studentNames.set(profile.id, profile.display_name || profile.email || t("teacherSubs.unnamed"));
    }

    const { data: feedbackRows } = await admin
      .from("submission_feedback")
      .select("id, submission_id, criteria_label, good_points, next_question, material_reference")
      .in(
        "submission_id",
        submissions.map((s) => s.id),
      );
    for (const row of (feedbackRows ?? []) as FeedbackRow[]) {
      const list = feedbackBySubmission.get(row.submission_id) ?? [];
      list.push(row);
      feedbackBySubmission.set(row.submission_id, list);
    }

    // F08: 学習者が「教師に共有する」を選んだ振り返りだけを見せる
    // (共有していない振り返りはこのクエリの時点で除外し、サーバー側で境界を守る)。
    const { data: reflectionRows } = await admin
      .from("reflections")
      .select("submission_id, what_learned, what_confused, next_goal")
      .eq("shared_with_teacher", true)
      .in(
        "submission_id",
        submissions.map((s) => s.id),
      );
    for (const row of (reflectionRows ?? []) as ReflectionRow[]) {
      reflectionBySubmission.set(row.submission_id, row);
    }

    // F24: 討論のAIジャッジ。教師はここで確認できるが修正はしない(最終評価は教師自身が行う)。
    const { data: judgmentRows } = await admin
      .from("discussion_judgments")
      .select("submission_id, logic_structure, evidence_quality, rebuttal_response, summary_comment")
      .in(
        "submission_id",
        submissions.map((s) => s.id),
      );
    for (const row of (judgmentRows ?? []) as JudgmentRow[]) {
      judgmentBySubmission.set(row.submission_id, row);
    }

    // ポートフォリオ: 教師自身が書いた評価(学習者のポートフォリオにも表示される)。
    const { data: entryRows } = await admin
      .from("portfolio_entries")
      .select("submission_id, teacher_assessment")
      .in(
        "submission_id",
        submissions.map((s) => s.id),
      );
    for (const row of entryRows ?? []) {
      teacherAssessmentBySubmission.set(row.submission_id, readAssessment(row.teacher_assessment));
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("teacherSubs.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("teacherSubs.title")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("teacherSubs.lead")}
      </p>

      <ul className="mt-8 space-y-4">
        {submissions.map((submission) => {
          const feedbackItems = feedbackBySubmission.get(submission.id) ?? [];
          const reflection = reflectionBySubmission.get(submission.id);
          const judgment = judgmentBySubmission.get(submission.id);
          const teacherAssessment = teacherAssessmentBySubmission.get(submission.id);
          return (
            <li
              key={submission.id}
              className="rounded-md border border-line px-4 py-3 text-sm"
            >
              <p className="text-xs font-medium text-ink-muted">
                {studentNames.get(submission.student_id) ?? t("teacherSubs.unknownLearner")} ・
                {formatDateTime(submission.created_at, lang)}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{submission.content}</p>

              {submission.feedback_status === "failed" && submission.feedback_error && (
                <p className="mt-2 text-xs text-danger">
                  {t("teacherSubs.feedbackError", { e: submission.feedback_error })}
                </p>
              )}

              {feedbackItems.length > 0 && (
                <div className="mt-4 space-y-4 border-t border-line-soft pt-3">
                  {feedbackItems.map((item) => {
                    const boundUpdateAction = updateFeedbackAction.bind(null, courseId, item.id);
                    return (
                      <form key={item.id} action={boundUpdateAction} className="space-y-2">
                        <p className="text-xs font-medium text-ink">
                          {item.criteria_label}
                        </p>
                        <label className="block text-xs text-ink-muted">
                          {t("teacherSubs.good")}
                          <textarea
                            name="goodPoints"
                            required
                            rows={2}
                            defaultValue={item.good_points}
                            className={`mt-1 ${inputClassName}`}
                          />
                        </label>
                        <label className="block text-xs text-ink-muted">
                          {t("teacherSubs.nextQ")}
                          <textarea
                            name="nextQuestion"
                            required
                            rows={2}
                            defaultValue={item.next_question}
                            className={`mt-1 ${inputClassName}`}
                          />
                        </label>
                        <label className="block text-xs text-ink-muted">
                          {t("teacherSubs.ref")}
                          <textarea
                            name="materialReference"
                            required
                            rows={2}
                            defaultValue={item.material_reference}
                            className={`mt-1 ${inputClassName}`}
                          />
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                        >
                          {t("teacherSubs.saveCriterion")}
                        </button>
                      </form>
                    );
                  })}
                </div>
              )}

              {judgment && (
                <div className="mt-4 space-y-1 border-t border-line-soft pt-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-ink">
                      {t("teacherSubs.judgeHeading")}
                    </p>
                    <form action={sendGradeToLmsAction.bind(null, courseId, submission.id)}>
                      <SubmitButton
                        pendingText={t("teacherSubs.sending")}
                        className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface disabled:opacity-50"
                      >
                        {t("teacherSubs.sendGrade")}
                      </SubmitButton>
                    </form>
                  </div>
                  <p className="text-ink-muted">
                    {t("teacherSubs.scores", { logic: judgment.logic_structure, evidence: judgment.evidence_quality, rebuttal: judgment.rebuttal_response })}
                  </p>
                  <p>{judgment.summary_comment}</p>
                  <p className="text-ink-faint">
                    {t("teacherSubs.judgeNote")}
                  </p>
                </div>
              )}

              {reflection && (
                <div className="mt-4 space-y-1 border-t border-line-soft pt-3 text-xs">
                  <p className="font-medium text-ink">
                    {t("teacherSubs.reflection")}
                  </p>
                  <p>
                    <span className="text-ink-muted">{t("portfolioEntry.learned")}</span>
                    {reflection.what_learned}
                  </p>
                  <p>
                    <span className="text-ink-muted">{t("portfolioEntry.confused")}</span>
                    {reflection.what_confused}
                  </p>
                  <p>
                    <span className="text-ink-muted">{t("portfolioEntry.nextGoal")}</span>
                    {reflection.next_goal}
                  </p>
                </div>
              )}

              <form
                action={saveTeacherAssessmentAction.bind(null, courseId, submission.id)}
                className="mt-4 space-y-2 border-t border-line-soft pt-3 text-xs"
              >
                <p className="font-medium text-ink">{t("teacherSubs.assessHeading")}</p>
                <p className="text-ink-faint">{t("teacherSubs.assessNote")}</p>
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="sr-only">{t("teacherSubs.ratingLegend")}</legend>
                  {[4, 3, 2, 1].map((r) => (
                    <label key={r} className="flex items-center gap-1">
                      <input type="radio" name="rating" value={r} defaultChecked={teacherAssessment?.rating === r} />
                      {ratingLabel(t, r)}
                    </label>
                  ))}
                </fieldset>
                <label htmlFor={`ta-${submission.id}`} className="sr-only">{t("teacherSubs.commentLabel")}</label>
                <textarea
                  id={`ta-${submission.id}`}
                  name="comment"
                  rows={2}
                  maxLength={1000}
                  defaultValue={teacherAssessment?.comment ?? ""}
                  placeholder={t("teacherSubs.commentPlaceholder")}
                  className={inputClassName}
                />
                <SubmitButton
                  pendingText={t("teacherSubs.saving")}
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                >
                  {t("teacherSubs.saveAssess")}
                </SubmitButton>
              </form>
            </li>
          );
        })}
        {submissions.length === 0 && (
          <li className="text-sm text-ink-muted">{t("teacherSubs.none")}</li>
        )}
      </ul>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
