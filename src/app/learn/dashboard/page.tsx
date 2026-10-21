import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { SubmitButton } from "@/components/submit-button";
import {
  addStudyPlanItemAction,
  toggleStudyPlanItemAction,
  deleteStudyPlanItemAction,
  generateLearnerProfileAction,
  generateLearnerSuggestionsAction,
  addSuggestionToPlanAction,
} from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { loadPortfolio } from "@/lib/portfolio/load";
import { loadLessonLabels } from "@/lib/courses/series";
import { summarizePortfolio } from "@/lib/portfolio/summary";

type LearnerProfileStatus = "pending" | "processing" | "done" | "failed";

interface LearnerProfileRow {
  status: LearnerProfileStatus;
  error: string | null;
  strengths: string | null;
  challenges: string | null;
  summary: string | null;
  generated_at: string | null;
}

interface LearnerSuggestionRow {
  avoid_misconception_question: string;
  inquiry_theme_suggestion: string;
  self_regulation_tip: string;
  challenge_level_tip: string;
}

const LEARNER_PROFILE_STATUS_LABELS: Record<LearnerProfileStatus, string> = {
  pending: "未生成",
  processing: "生成中",
  done: "生成済み",
  failed: "失敗",
};

// F23: 生徒ダッシュボード。
// 「学習者が自分の学習履歴(対話ログ、成果物、フィードバック、振り返り)を一覧で確認し、
// AIの提案をもとに次に取り組む学習計画を立てられる」(要件定義書4章)。教師ダッシュボード
// (F14)と同じ方針で、新規のAI呼び出しはせず既存データ(F05/F08/F11)を集計するだけにする。
// 「学習計画を立てられる」の部分だけは既存データで表現できないため、学習者が自分で
// 追加・完了・削除できる簡単な計画リスト(study_plan_items)を持たせている。

interface CourseStat {
  courseId: string;
  title: string;
  turnCount: number;
  submissionCount: number;
  lastActivityAt: string | null;
  inquiryThemeSuggestion: string | null;
}

interface NextGoalRow {
  courseTitle: string;
  content: string;
  createdAt: string;
}

interface PlanItem {
  id: string;
  course_id: string | null;
  content: string;
  done: boolean;
  created_at: string;
}

export default async function StudentDashboardPage() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);
  const portfolioSummary = summarizePortfolio((await loadPortfolio(admin, user.id)).entries);

  // F26: 横断的な学びの記録とAIフィードバック。授業をまたいだ蓄積のため courseId では絞らない。
  const { data: learnerProfileRow } = await admin
    .from("learner_profiles")
    .select("status, error, strengths, challenges, summary, generated_at")
    .eq("student_id", user.id)
    .maybeSingle();
  const learnerProfile = learnerProfileRow as LearnerProfileRow | null;

  const { data: learnerSuggestionRow } = await admin
    .from("learner_suggestions")
    .select("avoid_misconception_question, inquiry_theme_suggestion, self_regulation_tip, challenge_level_tip")
    .eq("student_id", user.id)
    .maybeSingle();
  const learnerSuggestion = learnerSuggestionRow as LearnerSuggestionRow | null;

  // 本人の議論と、本人が発言した探究のグループの議論(0044)。発言は本人のもの(author_student_id)だけを数える。
  const [{ data: ownSessions }, { data: authoredGroupTurns }] = await Promise.all([
    admin.from("learning_sessions").select("id, course_id").eq("student_id", user.id),
    admin.from("dialogue_turns").select("session_id").eq("author_student_id", user.id),
  ]);
  const ownIds = new Set((ownSessions ?? []).map((s) => s.id as string));
  const groupSessionIds = [...new Set((authoredGroupTurns ?? []).map((t) => t.session_id as string))].filter((id) => !ownIds.has(id));
  const { data: groupSessions } =
    groupSessionIds.length > 0
      ? await admin.from("learning_sessions").select("id, course_id").in("id", groupSessionIds)
      : { data: [] as { id: string; course_id: string | null }[] };
  const sessions = [...(ownSessions ?? []), ...(groupSessions ?? [])];
  // 授業回が削除された記録(course_id が null)は、授業ごとの集計には入れない(ポートフォリオでは控えの名前で見られる)。
  const sessionCourse = new Map<string, string>();
  for (const s of sessions) if (s.course_id) sessionCourse.set(s.id, s.course_id);
  const sessionIds = [...sessionCourse.keys()];
  const courseIds = [...new Set(sessionCourse.values())];

  const stats = new Map<string, CourseStat>();
  if (courseIds.length > 0) {
    const labels = await loadLessonLabels(admin, courseIds);
    for (const [id, label] of labels) {
      const c = { id, title: label };
      stats.set(c.id, {
        courseId: c.id,
        title: c.title,
        turnCount: 0,
        submissionCount: 0,
        lastActivityAt: null,
        inquiryThemeSuggestion: null,
      });
    }
  }
  const bumpActivity = (courseId: string, at: string) => {
    const stat = stats.get(courseId);
    if (stat && (!stat.lastActivityAt || at > stat.lastActivityAt)) stat.lastActivityAt = at;
  };

  if (sessionIds.length > 0) {
    const { data: turns } = await admin
      .from("dialogue_turns")
      .select("session_id, created_at")
      .in("session_id", sessionIds)
      .eq("speaker_type", "student")
      .eq("author_student_id", user.id);
    for (const turn of turns ?? []) {
      const courseId = sessionCourse.get(turn.session_id);
      if (!courseId) continue;
      const stat = stats.get(courseId);
      if (stat) stat.turnCount += 1;
      bumpActivity(courseId, turn.created_at);
    }
  }

  const { data: submissionRows } = await admin
    .from("submissions")
    .select("id, course_id, course_label, content, created_at")
    .eq("student_id", user.id);
  for (const s of submissionRows ?? []) {
    const stat = stats.get(s.course_id);
    if (stat) stat.submissionCount += 1;
    bumpActivity(s.course_id, s.created_at);
  }

  const { data: suggestions } = await admin
    .from("personalization_suggestions")
    .select("course_id, inquiry_theme_suggestion")
    .eq("student_id", user.id)
    .eq("status", "accepted");
  for (const s of suggestions ?? []) {
    const stat = stats.get(s.course_id);
    if (stat) stat.inquiryThemeSuggestion = s.inquiry_theme_suggestion;
  }

  // F08: 振り返りで学習者自身が書いた「次にやりたいこと」を、AIの提案とあわせて
  // 「次の学習計画」の材料として一覧表示する(新規のAI呼び出しはしない)。
  const nextGoals: NextGoalRow[] = [];
  const submissions = submissionRows ?? [];
  if (submissions.length > 0) {
    const { data: reflections } = await admin
      .from("reflections")
      .select("submission_id, next_goal, updated_at")
      .in(
        "submission_id",
        submissions.map((s) => s.id),
      );
    const submissionById = new Map(submissions.map((s) => [s.id, s]));
    for (const r of reflections ?? []) {
      const submission = submissionById.get(r.submission_id);
      if (!submission) continue;
      nextGoals.push({
        courseTitle: stats.get(submission.course_id)?.title ?? submission.course_label ?? "(不明)",
        content: r.next_goal,
        createdAt: r.updated_at,
      });
    }
    nextGoals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data: planItemRows } = await admin
    .from("study_plan_items")
    .select("id, course_id, content, done, created_at")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });
  const planItems = (planItemRows ?? []) as PlanItem[];

  const statList = [...stats.values()].sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current="学習ダッシュボード" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        学習ダッシュボード
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        すべての授業の学習状況を確認し、次の学習計画を立てます。
      </p>

      <section className="mt-6 rounded-lg border border-line p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium text-ink">ポートフォリオ</h2>
          <Link href="/learn/portfolio" className="text-xs text-accent hover:underline">
            すべて見る・書き出す →
          </Link>
        </div>
        {portfolioSummary.total === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">成果を提出すると、ここに記録が集まります。</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 text-center">
              {[
                ["成果", portfolioSummary.total],
                ["先生のコメント", portfolioSummary.withTeacherComment],
                ["自己評価がまだ", portfolioSummary.withoutSelfAssessment],
                ["公開用", portfolioSummary.shared],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-surface px-2 py-2">
                  <dt className="text-xs text-ink-muted">{label}</dt>
                  <dd className="text-lg font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="mt-3 space-y-1 text-sm">
              {portfolioSummary.latest.map((entry) => (
                <li key={entry.submissionId} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 truncate">
                    <span className="text-xs text-ink-faint">
                      {new Date(entry.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} ・ {entry.courseTitle}
                    </span>{" "}
                    {entry.content.slice(0, 40)}
                    {entry.content.length > 40 ? "…" : ""}
                  </span>
                  {!entry.selfAssessment && <span className="text-xs text-warn">自己評価を書こう</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="mt-6 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">
          次の学びに向けて(横断的な学びの記録とAIの提案)
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          全授業の記録から、次の学びに向けた努力の方向を提案します。押したときだけ生成されます。
          AIの提案は材料で、取り入れるかは自分で決めます。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">
            {LEARNER_PROFILE_STATUS_LABELS[learnerProfile?.status ?? "pending"]}
          </span>
          <form action={generateLearnerProfileAction}>
            <SubmitButton
              pendingText="生成中…"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
            >
              {learnerProfile?.status === "done" ? "再生成する" : "生成する"}
            </SubmitButton>
          </form>
        </div>
        {learnerProfile?.status === "failed" && learnerProfile.error && (
          <p className="mt-2 text-xs text-danger">{learnerProfile.error}</p>
        )}
        {learnerProfile?.status === "done" && (
          <div className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
            <p>
              <span className="text-xs font-medium text-ink-muted">得意な点: </span>
              {learnerProfile.strengths}
            </p>
            <p>
              <span className="text-xs font-medium text-ink-muted">課題: </span>
              {learnerProfile.challenges}
            </p>
            <p>
              <span className="text-xs font-medium text-ink-muted">学習履歴の要約: </span>
              {learnerProfile.summary}
            </p>

            <div className="mt-3 border-t border-line pt-3">
              <form action={generateLearnerSuggestionsAction}>
                <SubmitButton
                  pendingText="生成中…"
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                >
                  {learnerSuggestion ? "提案を再生成する" : "次に取り組むことの提案を生成する"}
                </SubmitButton>
              </form>

              {learnerSuggestion && (
                <ul className="mt-3 space-y-2 text-sm">
                  {(
                    [
                      ["avoid_misconception_question", "次に確かめてみるとよい問い"],
                      ["inquiry_theme_suggestion", "次の探究テーマの提案"],
                      ["self_regulation_tip", "自分で意識するとよい工夫"],
                      ["challenge_level_tip", "次に挑戦するとよい難易度の目安"],
                    ] as const
                  ).map(([kind, label]) => (
                    <li key={kind} className="rounded-md border border-line px-3 py-2">
                      <p className="text-xs font-medium text-ink-muted">{label}</p>
                      <p className="mt-1">{learnerSuggestion[kind]}</p>
                      <form action={addSuggestionToPlanAction.bind(null, kind)} className="mt-2">
                        <SubmitButton
                          pendingText="追加中…"
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                        >
                          学習計画に取り入れる
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink">授業ごとの学習状況</h2>
      <ul className="mt-3 space-y-2">
        {statList.map((stat) => (
          <li key={stat.courseId} className="rounded-md border border-line px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={`/learn/${stat.courseId}`} className="font-medium text-ink hover:underline">
                {stat.title}
              </Link>
              <Link href={`/learn/${stat.courseId}/portfolio`} className="shrink-0 text-xs text-ink-muted hover:underline">
                ポートフォリオ→
              </Link>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              発言{stat.turnCount}件・提出{stat.submissionCount}件
              {stat.lastActivityAt && `・最終活動 ${new Date(stat.lastActivityAt).toLocaleString("ja-JP")}`}
            </p>
            {stat.inquiryThemeSuggestion && (
              <p className="mt-1 text-xs text-accent">
                おすすめの探究テーマ: {stat.inquiryThemeSuggestion}
              </p>
            )}
          </li>
        ))}
        {statList.length === 0 && <li className="text-sm text-ink-muted">まだ活動記録がありません。</li>}
      </ul>

      {nextGoals.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink">
            振り返りで書いた「次にやりたいこと」
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {nextGoals.map((goal, i) => (
              <li key={i} className="rounded-md border border-line px-4 py-3">
                <p className="text-xs text-ink-faint">{goal.courseTitle}</p>
                <p className="mt-1">{goal.content}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">学習計画</h2>
      <p className="mt-1 text-xs text-ink-muted">
        上のAIの提案や振り返りを参考に、次に取り組むことを自分で書き留めておける。
      </p>
      <form action={addStudyPlanItemAction} className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="plan-content" className="sr-only">
          次に取り組むこと
        </label>
        <input
          id="plan-content"
          name="content"
          required
          placeholder="次に取り組むこと"
          className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <label htmlFor="plan-course" className="sr-only">
          関連する授業
        </label>
        <select
          id="plan-course"
          name="courseId"
          defaultValue=""
          className="min-w-0 max-w-full rounded-md border border-line px-2 py-2 text-sm bg-surface-raised"
        >
          <option value="">(授業を指定しない)</option>
          {statList.map((stat) => (
            <option key={stat.courseId} value={stat.courseId}>
              {stat.title}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="shrink-0 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          追加する
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {planItems.map((item) => {
          const boundToggle = toggleStudyPlanItemAction.bind(null, item.id);
          const boundDelete = deleteStudyPlanItemAction.bind(null, item.id);
          const courseTitle = item.course_id ? stats.get(item.course_id)?.title : null;
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className={item.done ? "text-ink-faint line-through" : ""}>{item.content}</span>
                {courseTitle && <span className="ml-2 text-xs text-ink-faint">[{courseTitle}]</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <form action={boundToggle}>
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                  >
                    {item.done ? "未完了に戻す" : "完了にする"}
                  </button>
                </form>
                <form action={boundDelete}>
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                  >
                    削除
                  </button>
                </form>
              </div>
            </li>
          );
        })}
        {planItems.length === 0 && <li className="text-sm text-ink-muted">まだ学習計画がありません。</li>}
      </ul>
    </div>
  );
}
