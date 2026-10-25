import Link from "next/link";
import { formatDateTime, getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { loadCourseStats } from "@/lib/teacher-guidance/stats";
import { SubmitButton } from "@/components/submit-button";
import { generateTeacherGuidanceAction } from "./actions";
import { InquiryRecordsPanel } from "./inquiry-records-panel";

interface GuidanceContent {
  classOverview: string;
  facilitation: string[];
  nextActivity: string;
  individuals: { studentId: string; observation: string; suggestedAction: string }[];
  studentCount: number;
}

// F14: 教師ダッシュボード。
// 「参加状況、つまずき、擬似メンバーの挙動を確認し、学級・個人の指導計画に活かす」
// (要件定義書4章)。「状況を確認するだけで終わらせず、次に何に取り組むかをその場で
// 決められる形にする」(要件定義書7章)ため、各行から学習者プロファイル・個別最適化の
// 判断(F09/F11)やペルソナの挙動監査(F20)へ直接リンクする。
// 新規のAI呼び出しは行わず、既存の蓄積データ(dialogue_turns/submissions/
// argument_evaluations/student_profiles)を集計するだけの読み取り専用画面にする
// (呼び出し回数を増やさないコスト方針、要件定義書10章)。
//
// 学習者一覧は学習セッション(learning_sessions)を基準にする。students/(F09/F11)は
// 提出物がある学習者だけを対象にしているが、ダッシュボードは「対話はしたが一度も
// 提出していない」学習者も参加状況の一部として拾う必要があるため、より広い基準にしている。

export default async function CourseDashboardPage({
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

  const { stats: statList, names: studentNames, turnIds, stepsTotal } = await loadCourseStats(admin, courseId);

  const { data: guidanceRow } = await admin
    .from("teacher_guidance")
    .select("status, error, content, generated_at")
    .eq("course_id", courseId)
    .maybeSingle();
  const guidance = guidanceRow?.status === "done" ? (guidanceRow.content as GuidanceContent | null) : null;

  const STRUGGLE_SCORE_THRESHOLD = 2.5; // 0〜5点中。閾値は暫定(運用しながら調整する)。

  // 擬似メンバーの挙動: F20と同じデータソースをペルソナ単位に集計する(詳細はF20の画面へ)。
  const { data: activePersonas } = await admin
    .from("personas")
    .select("id, name")
    .eq("course_id", courseId)
    .eq("status", "active");
  const personaNames = new Map((activePersonas ?? []).map((p) => [p.id, p.name]));

  const personaStats = new Map<string, { total: number; unwarranted: number }>();
  if (turnIds.length > 0) {
    const { data: personaEvaluations } = await admin
      .from("argument_evaluations")
      .select("persona_id, unwarranted_conformity")
      .in("dialogue_turn_id", turnIds)
      .not("persona_id", "is", null);
    for (const evaluation of personaEvaluations ?? []) {
      const key = evaluation.persona_id as string;
      const stat = personaStats.get(key) ?? { total: 0, unwarranted: 0 };
      stat.total += 1;
      if (evaluation.unwarranted_conformity) stat.unwarranted += 1;
      personaStats.set(key, stat);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("teacherDash.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("teacherDash.title")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("teacherDash.lead")}
      </p>

      <section className="mt-6 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">{t("teacherDash.hintsHeading")}</h2>
        <p className="mt-1 text-xs text-ink-muted">
          {t("teacherDash.hintsLead")}
        </p>
        <form action={generateTeacherGuidanceAction.bind(null, courseId)} className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingText={t("teacherDash.generating")}
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {guidance ? t("teacherDash.regenHints") : t("teacherDash.genHints")}
          </SubmitButton>
          {guidanceRow?.generated_at && guidance && (
            <span className="text-xs text-ink-faint">
              {t("teacherDash.generatedAt", { date: formatDateTime(guidanceRow.generated_at, lang), n: guidance.studentCount })}
            </span>
          )}
        </form>
        {guidanceRow?.status === "failed" && guidanceRow.error && (
          <p className="mt-2 text-xs text-danger">{guidanceRow.error}</p>
        )}
        {guidance && (
          <div className="mt-4 space-y-4 border-t border-line-soft pt-4 text-sm">
            <div>
              <p className="text-xs font-medium text-ink-muted">{t("teacherDash.overview")}</p>
              <p className="mt-1">{guidance.classOverview}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-muted">{t("teacherDash.facilitation")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {guidance.facilitation.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-muted">{t("teacherDash.nextActivity")}</p>
              <p className="mt-1">{guidance.nextActivity}</p>
            </div>
            {guidance.individuals.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink-muted">{t("teacherDash.individuals")}</p>
                <ul className="mt-1 space-y-2">
                  {guidance.individuals.map((item) => (
                    <li key={item.studentId} className="rounded-md border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="font-medium text-ink">{studentNames.get(item.studentId) ?? t("teacherDash.unknownLearner")}</span>
                        <Link href={`/courses/${courseId}/students#${item.studentId}`} className="text-xs text-ink-muted underline underline-offset-2">
                          {t("teacherDash.viewProfile")}
                        </Link>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">{item.observation}</p>
                      <p className="mt-1">{item.suggestedAction}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-ink-faint">
              {t("teacherDash.hintsNote")}
            </p>
          </div>
        )}
      </section>

      <h2 className="mt-8 text-sm font-medium text-ink">
        {t("teacherDash.participation")}
      </h2>
      <ul className="mt-3 space-y-2">
        {statList.map((stat) => {
          const struggling =
            (stat.avgScore !== null && stat.avgScore < STRUGGLE_SCORE_THRESHOLD) ||
            (stat.turnCount > 0 && stat.submissionCount === 0);
          return (
            <li
              key={stat.studentId}
              className={`rounded-md border px-4 py-3 text-sm ${
                struggling
                  ? "border-warn bg-warn-soft"
                  : "border-line"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {studentNames.get(stat.studentId) ?? t("teacherDash.unknownLearner")}
                </span>
                <Link
                  href={`/courses/${courseId}/students#${stat.studentId}`}
                  className="shrink-0 text-xs text-ink-muted underline underline-offset-2"
                >
                  {t("teacherDash.viewProfile2")}
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {t("teacherDash.statsLine", { steps: stepsTotal > 0 ? t("teacherDash.stepsPart", { done: stat.stepsDone, total: stepsTotal }) : "", turns: stat.turnCount, subs: stat.submissionCount })}
                {stat.avgScore !== null && t("teacherDash.avgPart", { n: stat.avgScore.toFixed(1) })}
                {stat.lastActivityAt &&
                  t("teacherDash.lastActive", { date: formatDateTime(stat.lastActivityAt, lang) })}
              </p>
              {stat.turnCount > 0 && stat.submissionCount === 0 && (
                <p className="mt-1 text-xs text-warn">
                  {t("teacherDash.noSubmit")}
                </p>
              )}
              {stat.avgScore !== null && stat.avgScore < STRUGGLE_SCORE_THRESHOLD && (
                <p className="mt-1 text-xs text-warn">
                  {t("teacherDash.lowScore")}
                </p>
              )}
              {stat.challenges && (
                <p className="mt-1 text-xs text-ink-muted">{t("teacherDash.challenge", { c: stat.challenges })}</p>
              )}
            </li>
          );
        })}
        {statList.length === 0 && (
          <li className="text-sm text-ink-muted">{t("teacherDash.noActive")}</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-ink">
        {t("teacherDash.behavior")}
      </h2>
      <ul className="mt-3 space-y-2">
        {[...personaStats.entries()].map(([personaId, stat]) => (
          <li key={personaId} className="flex flex-wrap items-center justify-between text-sm">
            <span>{personaNames.get(personaId) ?? t("teacherDash.pendingEtc")}</span>
            <span className="text-ink-muted">
              {t("teacherDash.conform", { u: stat.unwarranted, n: stat.total, p: Math.round((stat.unwarranted / stat.total) * 100) })}
            </span>
          </li>
        ))}
        {personaStats.size === 0 && <li className="text-sm text-ink-muted">{t("teacherDash.noEval")}</li>}
      </ul>
      <Link
        href={`/courses/${courseId}/conformity`}
        className="mt-2 inline-block text-xs text-ink-muted underline underline-offset-2"
      >
        {t("teacherDash.detail")}
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/audit`}
        className="mt-1 inline-block text-xs text-ink-muted underline underline-offset-2"
      >
        {t("teacherDash.review")}
      </Link>

      <InquiryRecordsPanel admin={admin} courseId={courseId} />

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
