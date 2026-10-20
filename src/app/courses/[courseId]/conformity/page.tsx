import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

// F20: ペルソナ設計と同調の計測。
// 論証評価(F20/F24共有コンポーネント、src/lib/ai/argument-evaluation.ts)で判定した
// 「新しい根拠の有無」と、ペルソナの自己申告「譲歩したか」を突き合わせ、
// 根拠なく同調した割合をペルソナごとに集計する。ペルソナの設定(F03/F04)を変えて
// この割合を比較するための画面。

interface EvaluationRow {
  id: string;
  dialogue_turn_id: string;
  persona_id: string | null;
  has_new_evidence: boolean;
  persona_conceded: boolean | null;
  unwarranted_conformity: boolean | null;
  summary_comment: string;
  created_at: string;
}

export default async function ConformityPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  // この授業のセッション → 学習者の発言(dialogue_turns)→ 論証評価、の順にたどる
  // (argument_evaluations は course_id を直接持たないため)。
  const { data: sessions } = await admin
    .from("learning_sessions")
    .select("id")
    .eq("course_id", courseId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  let evaluations: EvaluationRow[] = [];
  if (sessionIds.length > 0) {
    const { data: turns } = await admin
      .from("dialogue_turns")
      .select("id")
      .in("session_id", sessionIds)
      .eq("speaker_type", "student");
    const turnIds = (turns ?? []).map((t) => t.id);

    if (turnIds.length > 0) {
      const { data: evalRows } = await admin
        .from("argument_evaluations")
        .select(
          "id, dialogue_turn_id, persona_id, has_new_evidence, persona_conceded, unwarranted_conformity, summary_comment, created_at",
        )
        .in("dialogue_turn_id", turnIds)
        .order("created_at", { ascending: false });
      evaluations = (evalRows ?? []) as EvaluationRow[];
    }
  }

  const personaIds = [...new Set(evaluations.map((e) => e.persona_id).filter((id): id is string => !!id))];
  const personaNames = new Map<string, string>();
  if (personaIds.length > 0) {
    const { data: personas } = await admin.from("personas").select("id, name").in("id", personaIds);
    for (const p of personas ?? []) personaNames.set(p.id, p.name);
  }

  const statsByPersona = new Map<string, { total: number; unwarranted: number }>();
  for (const evaluation of evaluations) {
    const key = evaluation.persona_id ?? "(不明)";
    const stat = statsByPersona.get(key) ?? { total: 0, unwarranted: 0 };
    stat.total += 1;
    if (evaluation.unwarranted_conformity) stat.unwarranted += 1;
    statsByPersona.set(key, stat);
  }

  const flagged = evaluations.filter((e) => e.unwarranted_conformity);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/courses" }, { label: course.title, href: `/courses/${courseId}` }]} current="同調の計測" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        ペルソナ設計と同調の計測
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        学習者の発言に新しい根拠・具体例が無いのに、擬似メンバーが同調(譲歩)した割合を
        ペルソナごとに集計する。ペルソナの設定を変えて比較する材料にする。
      </p>

      <div className="mt-8 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-sm font-medium text-ink">
          ペルソナ別の同調率
        </h2>
        {statsByPersona.size === 0 && (
          <p className="mt-2 text-ink-muted">まだ評価データがありません。</p>
        )}
        <ul className="mt-3 space-y-2">
          {[...statsByPersona.entries()].map(([personaId, stat]) => (
            <li key={personaId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span>{personaNames.get(personaId) ?? personaId}</span>
              <span className="text-ink-muted">
                {stat.unwarranted}/{stat.total}件({Math.round((stat.unwarranted / stat.total) * 100)}%)
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-ink">
          根拠なく同調したと判定された発言({flagged.length}件)
        </h2>
        <ul className="mt-3 space-y-2">
          {flagged.map((evaluation) => (
            <li
              key={evaluation.id}
              className="rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm"
            >
              <p className="text-xs font-medium text-warn">
                {evaluation.persona_id ? (personaNames.get(evaluation.persona_id) ?? "不明") : "不明"} ・
                {new Date(evaluation.created_at).toLocaleString("ja-JP")}
              </p>
              <p className="mt-1 text-warn">{evaluation.summary_comment}</p>
            </li>
          ))}
          {flagged.length === 0 && evaluations.length > 0 && (
            <li className="text-sm text-ink-muted">
              根拠なく同調したと判定された発言はありません。
            </li>
          )}
        </ul>
      </div>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
