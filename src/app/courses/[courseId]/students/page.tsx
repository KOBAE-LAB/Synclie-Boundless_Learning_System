import { formatDateTime, getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import {
  generateStudentProfileAction,
  generatePersonalizationAction,
  decidePersonalizationAction,
} from "./actions";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

type ProfileStatus = "pending" | "processing" | "done" | "failed";
type SuggestionStatus = "suggested" | "accepted" | "declined";

interface StudentProfileRow {
  student_id: string;
  status: ProfileStatus;
  error: string | null;
  strengths: string | null;
  challenges: string | null;
  summary: string | null;
  generated_at: string | null;
}

interface PersonalizationRow {
  student_id: string;
  avoid_misconception_question: string;
  inquiry_theme_suggestion: string;
  prompting_adjustment: string;
  difficulty_adjustment: string;
  status: SuggestionStatus;
}

const STATUS_KEYS = { pending: "teacherStudents.s_pending", processing: "teacherStudents.s_processing", done: "teacherStudents.s_done", failed: "teacherStudents.s_failed" } as const satisfies Record<ProfileStatus, string>;

const SUGGESTION_STATUS_KEYS = { suggested: "teacherStudents.g_suggested", accepted: "teacherStudents.g_accepted", declined: "teacherStudents.g_declined" } as const satisfies Record<SuggestionStatus, string>;

export default async function StudentsPage({
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

  // この授業で提出物がある学習者を集める(受講登録の仕組みがまだ無いため、
  // 「活動履歴がある」ことを学習者一覧の代わりに使う)。
  const { data: submissions } = await admin
    .from("submissions")
    .select("student_id")
    .eq("course_id", courseId);
  const studentIds = [...new Set((submissions ?? []).map((s) => s.student_id))];

  const studentNames = new Map<string, string>();
  const profilesByStudent = new Map<string, StudentProfileRow>();

  if (studentIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .in("id", studentIds);
    for (const profile of profileRows ?? []) {
      studentNames.set(profile.id, profile.display_name || profile.email || t("teacherStudents.unnamed"));
    }

    const { data: studentProfileRows } = await admin
      .from("student_profiles")
      .select("student_id, status, error, strengths, challenges, summary, generated_at")
      .eq("course_id", courseId)
      .in("student_id", studentIds);
    for (const row of (studentProfileRows ?? []) as StudentProfileRow[]) {
      profilesByStudent.set(row.student_id, row);
    }
  }

  const suggestionsByStudent = new Map<string, PersonalizationRow>();
  if (studentIds.length > 0) {
    const { data: suggestionRows } = await admin
      .from("personalization_suggestions")
      .select(
        "student_id, avoid_misconception_question, inquiry_theme_suggestion, prompting_adjustment, difficulty_adjustment, status",
      )
      .eq("course_id", courseId)
      .in("student_id", studentIds);
    for (const row of (suggestionRows ?? []) as PersonalizationRow[]) {
      suggestionsByStudent.set(row.student_id, row);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("teacherStudents.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("teacherStudents.heading")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("teacherStudents.lead")}
      </p>

      <ul className="mt-8 space-y-4">
        {studentIds.map((studentId) => {
          const boundGenerateAction = generateStudentProfileAction.bind(null, courseId, studentId);
          const boundGeneratePersonalizationAction = generatePersonalizationAction.bind(
            null,
            courseId,
            studentId,
          );
          const boundAcceptAction = decidePersonalizationAction.bind(
            null,
            courseId,
            studentId,
            "accepted",
          );
          const boundDeclineAction = decidePersonalizationAction.bind(
            null,
            courseId,
            studentId,
            "declined",
          );
          const profile = profilesByStudent.get(studentId);
          const status: ProfileStatus = profile?.status ?? "pending";
          const suggestion = suggestionsByStudent.get(studentId);

          return (
            <li
              key={studentId}
              id={studentId}
              className="rounded-md border border-line px-4 py-3 text-sm scroll-mt-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {studentNames.get(studentId) ?? t("teacherStudents.unknownLearner")}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-faint">{t(STATUS_KEYS[status])}</span>
                  <form action={boundGenerateAction}>
                    <SubmitButton
                      pendingText={t("teacherStudents.generating")}
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                    >
                      {status === "done" ? t("teacherStudents.regen") : t("teacherStudents.genProfile")}
                    </SubmitButton>
                  </form>
                </div>
              </div>

              {status === "failed" && profile?.error && (
                <p className="mt-2 text-xs text-danger">{profile.error}</p>
              )}

              {status === "done" && (
                <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
                  <p>
                    <span className="text-xs font-medium text-ink-muted">{t("teacherStudents.strengths")}</span>
                    {profile?.strengths}
                  </p>
                  <p>
                    <span className="text-xs font-medium text-ink-muted">{t("teacherStudents.challenges")}</span>
                    {profile?.challenges}
                  </p>
                  <p>
                    <span className="text-xs font-medium text-ink-muted">{t("teacherStudents.summary")}</span>
                    {profile?.summary}
                  </p>
                  {profile?.generated_at && (
                    <p className="text-xs text-ink-faint">
                      {t("teacherStudents.generatedAt", { d: formatDateTime(profile.generated_at, lang) })}
                    </p>
                  )}
                </div>
              )}

              {status === "done" && (
                <div className="mt-3 border-t border-line-soft pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-medium text-ink">
                      {t("teacherStudents.personalization")}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {suggestion && (
                        <span className="text-xs text-ink-faint">
                          {t(SUGGESTION_STATUS_KEYS[suggestion.status])}
                        </span>
                      )}
                      <form action={boundGeneratePersonalizationAction}>
                        <SubmitButton
                          pendingText={t("teacherStudents.generating")}
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                        >
                          {suggestion ? t("teacherStudents.regen") : t("teacherStudents.genSuggest")}
                        </SubmitButton>
                      </form>
                    </div>
                  </div>

                  {suggestion && (
                    <div className="mt-2 space-y-2">
                      <p>
                        <span className="text-xs text-ink-muted">{t("teacherStudents.avoid")}</span>
                        {suggestion.avoid_misconception_question}
                      </p>
                      <p>
                        <span className="text-xs text-ink-muted">{t("teacherStudents.theme")}</span>
                        {suggestion.inquiry_theme_suggestion}
                      </p>
                      <p>
                        <span className="text-xs text-ink-muted">{t("teacherStudents.prompting")}</span>
                        {suggestion.prompting_adjustment}
                      </p>
                      <p>
                        <span className="text-xs text-ink-muted">{t("teacherStudents.difficulty")}</span>
                        {suggestion.difficulty_adjustment}
                      </p>

                      {suggestion.status === "suggested" && (
                        <div className="flex gap-2">
                          <form action={boundAcceptAction}>
                            <button
                              type="submit"
                              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                            >
                              {t("teacherStudents.adopt")}
                            </button>
                          </form>
                          <form action={boundDeclineAction}>
                            <button
                              type="submit"
                              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                            >
                              {t("teacherStudents.decline")}
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {studentIds.length === 0 && (
          <li className="text-sm text-ink-muted">{t("teacherStudents.none")}</li>
        )}
      </ul>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
