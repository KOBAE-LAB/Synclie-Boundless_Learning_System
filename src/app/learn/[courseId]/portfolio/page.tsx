import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { requireEnrollment } from "@/lib/courses/enrollment";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

// F08: ポートフォリオ。成果物・フィードバック・振り返りを時系列で並べ、
// 学習者本人がいつでも見返せるようにする(要件定義書7章)。読み取り専用。

interface SubmissionRow {
  id: string;
  content: string;
  created_at: string;
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
  shared_with_teacher: boolean;
}

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("student");

  const admin = createAdminClient();
  await requireConsent(admin, user.id);
  await requireEnrollment(admin, courseId, user.id);

  const { data: course } = await admin
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) {
    notFound();
  }

  const { data: submissionRows } = await admin
    .from("submissions")
    .select("id, content, created_at")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .order("created_at", { ascending: true });
  const submissions = (submissionRows ?? []) as SubmissionRow[];

  const feedbackBySubmission = new Map<string, FeedbackRow[]>();
  const reflectionBySubmission = new Map<string, ReflectionRow>();

  if (submissions.length > 0) {
    const submissionIds = submissions.map((s) => s.id);

    const { data: feedbackRows } = await admin
      .from("submission_feedback")
      .select("id, submission_id, criteria_label, good_points, next_question, material_reference")
      .in("submission_id", submissionIds);
    for (const row of (feedbackRows ?? []) as FeedbackRow[]) {
      const list = feedbackBySubmission.get(row.submission_id) ?? [];
      list.push(row);
      feedbackBySubmission.set(row.submission_id, list);
    }

    const { data: reflectionRows } = await admin
      .from("reflections")
      .select("submission_id, what_learned, what_confused, next_goal, shared_with_teacher")
      .in("submission_id", submissionIds);
    for (const row of (reflectionRows ?? []) as ReflectionRow[]) {
      reflectionBySubmission.set(row.submission_id, row);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }, { label: course.title, href: `/learn/${courseId}` }]} current="ポートフォリオ" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        ポートフォリオ(F08)
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        成果・フィードバック・振り返りを時系列で振り返れます。
      </p>

      <ol className="mt-8 space-y-6">
        {submissions.map((submission, index) => {
          const feedbackItems = feedbackBySubmission.get(submission.id) ?? [];
          const reflection = reflectionBySubmission.get(submission.id);

          return (
            <li
              key={submission.id}
              className="rounded-md border border-line px-4 py-4 text-sm"
            >
              <p className="text-xs font-medium text-ink-faint">
                {index + 1}件目 ・ {new Date(submission.created_at).toLocaleString("ja-JP")}
              </p>

              <div className="mt-2">
                <p className="text-xs font-medium text-ink-muted">成果</p>
                <p className="mt-1 whitespace-pre-wrap">{submission.content}</p>
              </div>

              {feedbackItems.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-line pt-3">
                  <p className="text-xs font-medium text-ink-muted">
                    AIフィードバック
                  </p>
                  {feedbackItems.map((item) => (
                    <div key={item.id}>
                      <p className="text-xs font-medium text-ink-muted">
                        {item.criteria_label}
                      </p>
                      <p className="mt-1">
                        <span className="text-ink-muted">良い点: </span>
                        {item.good_points}
                      </p>
                      <p className="mt-1">
                        <span className="text-ink-muted">次に考える問い: </span>
                        {item.next_question}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {reflection && (
                <div className="mt-4 space-y-1 border-t border-line pt-3">
                  <p className="text-xs font-medium text-ink-muted">
                    振り返り{reflection.shared_with_teacher && "(教師に共有中)"}
                  </p>
                  <p>
                    <span className="text-ink-muted">学んだこと: </span>
                    {reflection.what_learned}
                  </p>
                  <p>
                    <span className="text-ink-muted">迷ったこと: </span>
                    {reflection.what_confused}
                  </p>
                  <p>
                    <span className="text-ink-muted">次にやりたいこと: </span>
                    {reflection.next_goal}
                  </p>
                </div>
              )}
            </li>
          );
        })}
        {submissions.length === 0 && (
          <li className="text-sm text-ink-muted">
            まだ成果がありません。授業画面から成果を提出してみましょう。
          </li>
        )}
      </ol>

      <BackLink href={`/learn/${courseId}`} label={course.title} />
    </div>
  );
}
