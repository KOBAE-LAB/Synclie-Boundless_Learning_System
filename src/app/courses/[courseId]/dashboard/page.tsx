import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

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

interface StudentStat {
  studentId: string;
  turnCount: number;
  submissionCount: number;
  lastActivityAt: string | null;
  evaluationCount: number;
  avgScore: number | null;
  challenges: string | null;
}

export default async function CourseDashboardPage({
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

  const { data: sessions } = await admin
    .from("learning_sessions")
    .select("id, student_id")
    .eq("course_id", courseId);
  const sessionStudent = new Map<string, string>();
  for (const session of sessions ?? []) {
    if (session.student_id) sessionStudent.set(session.id, session.student_id);
  }
  const sessionIds = [...sessionStudent.keys()];
  const studentIds = [...new Set(sessionStudent.values())];

  const stats = new Map<string, StudentStat>();
  for (const studentId of studentIds) {
    stats.set(studentId, {
      studentId,
      turnCount: 0,
      submissionCount: 0,
      lastActivityAt: null,
      evaluationCount: 0,
      avgScore: null,
      challenges: null,
    });
  }
  const bumpLastActivity = (studentId: string, at: string) => {
    const stat = stats.get(studentId);
    if (stat && (!stat.lastActivityAt || at > stat.lastActivityAt)) stat.lastActivityAt = at;
  };

  const turnStudentByTurnId = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: turns } = await admin
      .from("dialogue_turns")
      .select("id, session_id, created_at")
      .in("session_id", sessionIds)
      .eq("speaker_type", "student");
    for (const turn of turns ?? []) {
      const studentId = sessionStudent.get(turn.session_id);
      if (!studentId) continue;
      turnStudentByTurnId.set(turn.id, studentId);
      const stat = stats.get(studentId);
      if (stat) stat.turnCount += 1;
      bumpLastActivity(studentId, turn.created_at);
    }
  }

  if (studentIds.length > 0) {
    const { data: submissions } = await admin
      .from("submissions")
      .select("student_id, created_at")
      .eq("course_id", courseId)
      .in("student_id", studentIds);
    for (const submission of submissions ?? []) {
      const stat = stats.get(submission.student_id);
      if (stat) stat.submissionCount += 1;
      bumpLastActivity(submission.student_id, submission.created_at);
    }
  }

  // つまずき: 論証評価(F20/F24共有コンポーネント)の平均点が低い学習者を拾う
  // (新規のAI呼び出しはせず、F05の対話で既に計測済みのスコアを集計するだけ)。
  const turnIds = [...turnStudentByTurnId.keys()];
  if (turnIds.length > 0) {
    const { data: evaluations } = await admin
      .from("argument_evaluations")
      .select("dialogue_turn_id, logic_structure, evidence_quality, rebuttal_response")
      .in("dialogue_turn_id", turnIds);
    const scoreSum = new Map<string, number>();
    // 擬似メンバーが複数話した発言には、メンバーごとに評価の行があり(F20の同調の記録のため)、
    // 点数は同じ値が重複する。平均点は、学習者の発言ごとに1回だけ数える。
    const countedTurns = new Set<string>();
    for (const evaluation of evaluations ?? []) {
      if (countedTurns.has(evaluation.dialogue_turn_id)) continue;
      countedTurns.add(evaluation.dialogue_turn_id);
      const studentId = turnStudentByTurnId.get(evaluation.dialogue_turn_id);
      if (!studentId) continue;
      const stat = stats.get(studentId);
      if (!stat) continue;
      const avg =
        (evaluation.logic_structure + evaluation.evidence_quality + evaluation.rebuttal_response) / 3;
      stat.evaluationCount += 1;
      scoreSum.set(studentId, (scoreSum.get(studentId) ?? 0) + avg);
    }
    for (const stat of stats.values()) {
      if (stat.evaluationCount > 0) {
        stat.avgScore = (scoreSum.get(stat.studentId) ?? 0) / stat.evaluationCount;
      }
    }
  }

  // F09で既にプロファイルが生成済みなら、その「課題」を「つまずき」の具体的な手がかりとして表示する
  // (ここでは生成しない。教師がstudents/で明示的に押したときだけ生成する方針を踏襲する)。
  if (studentIds.length > 0) {
    const { data: profiles } = await admin
      .from("student_profiles")
      .select("student_id, challenges")
      .eq("course_id", courseId)
      .eq("status", "done")
      .in("student_id", studentIds);
    for (const profile of profiles ?? []) {
      const stat = stats.get(profile.student_id);
      if (stat) stat.challenges = profile.challenges;
    }
  }

  const studentNames = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .in("id", studentIds);
    for (const profile of profileRows ?? []) {
      studentNames.set(profile.id, profile.display_name || profile.email || "(名称未設定)");
    }
  }

  const STRUGGLE_SCORE_THRESHOLD = 2.5; // 0〜5点中。閾値は暫定(運用しながら調整する)。
  const statList = studentIds
    .map((id) => stats.get(id)!)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));

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
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/courses" }, { label: course.title, href: `/courses/${courseId}` }]} current="教師ダッシュボード" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        教師ダッシュボード(F14)
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        参加状況・つまずき・擬似メンバーの挙動をまとめて確認し、学級・個人の指導計画に活かす。
        各行から学習者プロファイルの確認・生成(F09)や個別最適化の判断(F11)にそのまま進める。
      </p>

      <h2 className="mt-8 text-sm font-medium text-ink">
        学習者の参加状況とつまずき
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
                  {studentNames.get(stat.studentId) ?? "(不明な学習者)"}
                </span>
                <Link
                  href={`/courses/${courseId}/students#${stat.studentId}`}
                  className="shrink-0 text-xs text-ink-muted hover:underline"
                >
                  プロファイル・提案を見る(F09/F11)→
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                発言{stat.turnCount}件・提出{stat.submissionCount}件
                {stat.avgScore !== null && `・論証評価平均${stat.avgScore.toFixed(1)}点`}
                {stat.lastActivityAt &&
                  `・最終活動 ${new Date(stat.lastActivityAt).toLocaleString("ja-JP")}`}
              </p>
              {stat.turnCount > 0 && stat.submissionCount === 0 && (
                <p className="mt-1 text-xs text-warn">
                  対話はあるが、まだ成果(F06)を提出していない。
                </p>
              )}
              {stat.avgScore !== null && stat.avgScore < STRUGGLE_SCORE_THRESHOLD && (
                <p className="mt-1 text-xs text-warn">
                  論証評価の平均が低め(根拠・論理構成・反論への応答)。
                </p>
              )}
              {stat.challenges && (
                <p className="mt-1 text-xs text-ink-muted">課題(F09): {stat.challenges}</p>
              )}
            </li>
          );
        })}
        {statList.length === 0 && (
          <li className="text-sm text-ink-muted">まだ活動記録のある学習者がいません。</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-ink">
        擬似メンバーの挙動(F20)
      </h2>
      <ul className="mt-3 space-y-2">
        {[...personaStats.entries()].map(([personaId, stat]) => (
          <li key={personaId} className="flex flex-wrap items-center justify-between text-sm">
            <span>{personaNames.get(personaId) ?? "(承認待ち等)"}</span>
            <span className="text-ink-muted">
              根拠なく同調 {stat.unwarranted}/{stat.total}件(
              {Math.round((stat.unwarranted / stat.total) * 100)}%)
            </span>
          </li>
        ))}
        {personaStats.size === 0 && <li className="text-sm text-ink-muted">まだ評価データがありません。</li>}
      </ul>
      <Link
        href={`/courses/${courseId}/conformity`}
        className="mt-2 inline-block text-xs text-ink-muted hover:underline"
      >
        発言単位の詳細を見る(F20)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/audit`}
        className="mt-1 inline-block text-xs text-ink-muted hover:underline"
      >
        発言を確認・修正する(F15)→
      </Link>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
