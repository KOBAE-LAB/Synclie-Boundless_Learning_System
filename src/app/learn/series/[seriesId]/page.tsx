import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { isEnrolledInSeries } from "@/lib/courses/enrollment";
import { lessonName, seriesLabel } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

// 履修している授業シリーズの、授業回(第1回、第2回…)の一覧。公開されている回だけを見せ、
// 回ごとの進み具合(まだ/学習中/議論を終えた)と、学習の流れ(インプット・アウトプット)の進みを出す。
export default async function LearnSeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);
  if (!(await isEnrolledInSeries(admin, seriesId, user.id))) {
    redirect("/learn?not_enrolled=1");
  }

  const { data: series } = await admin.from("course_series").select("id, title, subject, planned_lessons, archived_at").eq("id", seriesId).maybeSingle();
  if (!series) notFound();

  const { data: lessons } = await admin
    .from("courses")
    .select("id, title, lesson_no, mode")
    .eq("series_id", seriesId)
    .eq("released", true)
    .order("lesson_no", { ascending: true });
  const lessonIds = (lessons ?? []).map((l) => l.id);

  const sessionByLesson = new Map<string, { ended_at: string | null }>();
  const stepTotal = new Map<string, number>();
  const stepDone = new Map<string, number>();
  if (lessonIds.length > 0) {
    const [{ data: sessions }, { data: steps }] = await Promise.all([
      admin
        .from("learning_sessions")
        .select("course_id, ended_at, started_at")
        .eq("student_id", user.id)
        .in("course_id", lessonIds)
        .order("started_at", { ascending: false }),
      admin.from("course_steps").select("id, course_id").in("course_id", lessonIds),
    ]);
    for (const s of sessions ?? []) if (!sessionByLesson.has(s.course_id)) sessionByLesson.set(s.course_id, s);
    const courseOfStep = new Map<string, string>();
    for (const st of steps ?? []) {
      courseOfStep.set(st.id, st.course_id);
      stepTotal.set(st.course_id, (stepTotal.get(st.course_id) ?? 0) + 1);
    }
    if (courseOfStep.size > 0) {
      const { data: progress } = await admin
        .from("step_progress")
        .select("step_id")
        .eq("student_id", user.id)
        .in("step_id", [...courseOfStep.keys()]);
      for (const p of progress ?? []) {
        const courseId = courseOfStep.get(p.step_id);
        if (courseId) stepDone.set(courseId, (stepDone.get(courseId) ?? 0) + 1);
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current={series.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{seriesLabel(series.title, series.planned_lessons)}</h1>
      {series.subject && <p className="mt-1 text-sm text-ink-muted">{series.subject}</p>}
      {series.archived_at && (
        <p className="mt-3 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          このシリーズは終了しています。記録は見返せますが、新しい発言や提出はできません。
        </p>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">授業回({(lessons ?? []).length}回が公開中)</h2>
      <ol className="mt-3 space-y-2">
        {(lessons ?? []).map((lesson) => {
          const session = sessionByLesson.get(lesson.id);
          const status = !session ? "まだ" : session.ended_at ? "議論を終えた" : "学習中";
          const total = stepTotal.get(lesson.id) ?? 0;
          return (
            <li key={lesson.id}>
              <Link
                href={`/learn/${lesson.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
              >
                <span className="font-medium text-ink">{lessonName(lesson.lesson_no, lesson.title)}</span>
                <span className="text-xs text-ink-muted">
                  {total > 0 && `ステップ${stepDone.get(lesson.id) ?? 0}/${total}・`}
                  {status}
                </span>
              </Link>
            </li>
          );
        })}
        {(lessons ?? []).length === 0 && (
          <li className="text-sm text-ink-muted">まだ公開されている授業回がありません。先生が公開すると、ここに表示されます。</li>
        )}
      </ol>

      <BackLink href="/learn" label="授業一覧" />
    </div>
  );
}
