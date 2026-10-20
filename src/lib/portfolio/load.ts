import type { createAdminClient } from "@/lib/supabase/server";
import { fiscalYearOf, readAssessment } from "./assessment";
import type { DiscussionSummary, Portfolio, PortfolioEntry } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

interface SubmissionRow {
  id: string;
  course_id: string;
  session_id: string | null;
  content: string;
  created_at: string;
}

function readDiscussion(value: unknown): DiscussionSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string" || v.summary === "") return null;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  return { summary: v.summary, keyPoints: strings(v.keyPoints), nextQuestions: strings(v.nextQuestions) };
}

/**
 * 学習者1人のポートフォリオを、全授業を横断して読み込む(新しい順ではなく、時系列=古い順)。
 * 既存のテーブル(提出物・フィードバック・ジャッジ・振り返り・議論のまとめ)を束ねるだけで、
 * コピーは作らない。courseId を渡すとその授業だけに絞る。
 */
export async function loadPortfolio(
  admin: AdminClient,
  studentId: string,
  options: { courseId?: string } = {},
): Promise<Portfolio> {
  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", studentId).maybeSingle();

  let query = admin
    .from("submissions")
    .select("id, course_id, session_id, content, created_at")
    .eq("student_id", studentId);
  if (options.courseId) query = query.eq("course_id", options.courseId);
  const { data: submissionRows } = await query.order("created_at", { ascending: true });
  const submissions = (submissionRows ?? []) as SubmissionRow[];

  const portfolio: Portfolio = {
    learnerName: profile?.display_name ?? "",
    generatedAt: new Date().toISOString(),
    entries: [],
  };
  if (submissions.length === 0) return portfolio;

  const submissionIds = submissions.map((s) => s.id);
  const courseIds = [...new Set(submissions.map((s) => s.course_id))];
  const sessionIds = [...new Set(submissions.map((s) => s.session_id).filter((id): id is string => !!id))];

  const [courses, feedback, judgments, reflections, entries, sessions] = await Promise.all([
    admin.from("courses").select("id, title").in("id", courseIds),
    admin.from("submission_feedback").select("submission_id, criteria_label, good_points, next_question").in("submission_id", submissionIds),
    admin.from("discussion_judgments").select("submission_id, logic_structure, evidence_quality, rebuttal_response, summary_comment").in("submission_id", submissionIds),
    admin.from("reflections").select("submission_id, what_learned, what_confused, next_goal").in("submission_id", submissionIds),
    admin.from("portfolio_entries").select("submission_id, self_assessment, teacher_assessment, shared").eq("student_id", studentId).in("submission_id", submissionIds),
    sessionIds.length > 0
      ? admin.from("learning_sessions").select("id, closing_summary").in("id", sessionIds)
      : Promise.resolve({ data: [] as { id: string; closing_summary: unknown }[] }),
  ]);

  const titleByCourse = new Map((courses.data ?? []).map((c) => [c.id as string, c.title as string]));
  const feedbackBy = new Map<string, PortfolioEntry["feedback"]>();
  for (const f of feedback.data ?? []) {
    const list = feedbackBy.get(f.submission_id) ?? [];
    list.push({ criteriaLabel: f.criteria_label, goodPoints: f.good_points, nextQuestion: f.next_question });
    feedbackBy.set(f.submission_id, list);
  }
  const judgmentBy = new Map((judgments.data ?? []).map((j) => [j.submission_id as string, j]));
  const reflectionBy = new Map((reflections.data ?? []).map((r) => [r.submission_id as string, r]));
  const entryBy = new Map((entries.data ?? []).map((e) => [e.submission_id as string, e]));
  const summaryBy = new Map((sessions.data ?? []).map((s) => [s.id as string, readDiscussion(s.closing_summary)]));

  portfolio.entries = submissions.map((s) => {
    const j = judgmentBy.get(s.id);
    const r = reflectionBy.get(s.id);
    const e = entryBy.get(s.id);
    return {
      submissionId: s.id,
      courseId: s.course_id,
      courseTitle: titleByCourse.get(s.course_id) ?? "(削除された授業)",
      createdAt: s.created_at,
      fiscalYear: fiscalYearOf(s.created_at),
      content: s.content,
      selfAssessment: readAssessment(e?.self_assessment),
      teacherAssessment: readAssessment(e?.teacher_assessment),
      shared: e?.shared === true,
      feedback: feedbackBy.get(s.id) ?? [],
      judgment: j
        ? {
            logicStructure: j.logic_structure,
            evidenceQuality: j.evidence_quality,
            rebuttalResponse: j.rebuttal_response,
            summaryComment: j.summary_comment,
          }
        : null,
      reflection: r ? { whatLearned: r.what_learned, whatConfused: r.what_confused, nextGoal: r.next_goal } : null,
      discussion: s.session_id ? (summaryBy.get(s.session_id) ?? null) : null,
    };
  });
  return portfolio;
}

/** 公開リンクで見せてよい形に絞る: 本人が公開用に選んだ成果だけ。振り返り・AIフィードバックなど非公開の記録は外す。 */
export function toSharedView(portfolio: Portfolio): Portfolio {
  return {
    ...portfolio,
    entries: portfolio.entries
      .filter((e) => e.shared)
      .map((e) => ({ ...e, feedback: [], judgment: null, reflection: null })),
  };
}
