import { createAdminClient } from "@/lib/supabase/server";
import { searchMaterialChunks } from "@/lib/rag/search";
import { summarizeDiscussion, type DiscussionSummary } from "@/lib/ai/discussion-wrapup";
import { getTimeStatus } from "@/lib/learn/session-end";
import { applyTurnCorrections } from "@/lib/records/corrections";
import { enqueueJob, scheduleJobRun } from "@/lib/inquiry/queue";
import { NEEDS_GROUP_MESSAGE, resolveSessionScope, scopeSessionQuery } from "@/lib/learn/session-scope";

type AdminClient = ReturnType<typeof createAdminClient>;

export type EndReason = "time_limit" | "ai_suggested" | "student";

/**
 * 終わった理由を、サーバー側の事実から決める(クライアントの申告は信用しない):
 * 制限時間を過ぎていれば time_limit、AIが「まとめ」を提案済みなら ai_suggested、
 * どちらでもなければ student(本人が自分から終えた)。
 */
export function decideEndReason(params: { isOverTime: boolean; closeSuggestedAt: string | null }): EndReason {
  if (params.isOverTime) return "time_limit";
  if (params.closeSuggestedAt) return "ai_suggested";
  return "student";
}

/**
 * 議論を終えて、AIのまとめを作る。同じ議論を二重に終えても、最初のまとめを返す(冪等)。
 * 終えた議論には、以後発言できない(getOrCreateSession が拒否する)。成果の提出は引き続きできる。
 */
export async function closeDiscussion(
  admin: AdminClient,
  courseId: string,
  studentId: string,
): Promise<{ summary: DiscussionSummary; alreadyEnded: boolean }> {
  // 探究シリーズ(0044)では、グループの共有の議論を、メンバーの誰でも終えられる。
  const scope = await resolveSessionScope(admin, courseId, studentId);
  if (scope.kind === "needs_group") throw new Error(NEEDS_GROUP_MESSAGE);
  const { data: session } = await scopeSessionQuery(
    admin
      .from("learning_sessions")
      .select("id, started_at, ended_at, close_suggested_at, closing_summary, project_id")
      .eq("course_id", courseId),
    scope,
  )
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    throw new Error("議論がまだ始まっていません。");
  }
  if (session.ended_at && session.closing_summary) {
    return { summary: session.closing_summary as DiscussionSummary, alreadyEnded: true };
  }

  // 授業の情報と発言の記録は互いに独立なので、並行して取得する。
  const [{ data: course }, { data: turns }] = await Promise.all([
    admin
      .from("courses")
      .select("title, objective, learner_level, time_limit_minutes, time_limit_policy")
      .eq("id", courseId)
      .maybeSingle(),
    // 教師が監査で直した発言は、直した内容でまとめる(元の発言は①として残る)。
    admin
      .from("dialogue_turns")
      .select("id, speaker_type, content, persona_id, persona_name")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(80)
      .then(({ data }) => applyTurnCorrections(admin, data ?? []))
      .then((data) => ({ data })),
  ]);
  if (!course) throw new Error("授業が見つかりません。");

  // 話者名の取得と、参考資料の検索(埋め込みAPIを呼ぶ)も、互いに独立なので並行する。
  // 資料の検索は、失敗してもまとめ自体は作る。
  const personaIds = [...new Set((turns ?? []).map((t) => t.persona_id).filter((id): id is string => !!id))];
  const [{ data: personaRows }, materialText] = await Promise.all([
    personaIds.length > 0 ? admin.from("personas").select("id, name").in("id", personaIds) : { data: [] },
    searchMaterialChunks(courseId, course.objective || course.title)
      .then((chunks) => chunks.join("\n\n"))
      .catch(() => ""),
  ]);
  const names = new Map((personaRows ?? []).map((p) => [p.id, p.name]));
  const transcript = (turns ?? [])
    .map((t) =>
      t.speaker_type === "student"
        ? `学習者: ${t.content}`
        : `${(t.persona_id ? names.get(t.persona_id) : undefined) ?? t.persona_name ?? "擬似メンバー"}: ${t.content}`,
    )
    .join("\n");
  if (!transcript) {
    throw new Error("まとめる発言がまだありません。");
  }

  const summary = await summarizeDiscussion({
    transcript,
    objective: course.objective,
    learnerLevel: course.learner_level,
    materialText,
  });

  const timeStatus = getTimeStatus({
    startedAt: session.started_at,
    limitMinutes: course.time_limit_minutes,
    policy: course.time_limit_policy,
  });
  const { error } = await admin
    .from("learning_sessions")
    .update({
      ended_at: new Date().toISOString(),
      end_reason: decideEndReason({ isOverTime: timeStatus.isOver, closeSuggestedAt: session.close_suggested_at }),
      closing_summary: summary,
    })
    .eq("id", session.id)
    .is("ended_at", null);
  if (error) {
    throw new Error(`議論の終了の記録に失敗しました: ${error.message}`);
  }
  // ②抽出層(要件定義書14章ステップ5): 議論が終わったら、印の付いた場面からエピソードを作る。
  // 学習者を待たせないよう、レスポンスを返した後(after())に実行する。印が無ければAIは呼ばれない。
  if (session.project_id) {
    await enqueueJob(admin, { kind: "extract_session", projectId: session.project_id, sessionId: session.id });
    scheduleJobRun({ projectId: session.project_id });
  }
  return { summary, alreadyEnded: false };
}
