import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface StudentStat {
  studentId: string;
  turnCount: number;
  submissionCount: number;
  lastActivityAt: string | null;
  evaluationCount: number;
  /** 論証評価(0〜5)の3観点の平均。評価がまだ無ければ null */
  avgScore: number | null;
  axisAvg: { logic: number; evidence: number; rebuttal: number } | null;
  strengths: string | null;
  challenges: string | null;
  /** 学習の流れ(ステップ)を終えた数。ステップが無い授業では 0 */
  stepsDone: number;
}

export interface CourseStats {
  stats: StudentStat[];
  names: Map<string, string>;
  /** この授業の学習者の発言(dialogue_turns)のid。擬似メンバーの挙動の集計に使う */
  turnIds: string[];
  /** この授業のステップ数(0なら学習の流れは未設定) */
  stepsTotal: number;
}

/**
 * 教師ダッシュボード(F14)の学習者ごとの集計。新規のAI呼び出しはせず、蓄積済みのデータを数えるだけ。
 * 学習者一覧は learning_sessions を基準にする(対話はしたが未提出の学習者も拾うため)。
 */
export async function loadCourseStats(admin: AdminClient, courseId: string): Promise<CourseStats> {
  const { data: sessions } = await admin.from("learning_sessions").select("id, student_id").eq("course_id", courseId);
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
      axisAvg: null,
      strengths: null,
      challenges: null,
      stepsDone: 0,
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

  // つまずき: 論証評価(F20/F24共有コンポーネント)の平均点。F05の対話で計測済みのスコアを集計するだけ。
  const turnIds = [...turnStudentByTurnId.keys()];
  if (turnIds.length > 0) {
    const { data: evaluations } = await admin
      .from("argument_evaluations")
      .select("dialogue_turn_id, logic_structure, evidence_quality, rebuttal_response")
      .in("dialogue_turn_id", turnIds);
    const sums = new Map<string, { logic: number; evidence: number; rebuttal: number }>();
    // 擬似メンバーが複数話した発言には、メンバーごとに評価の行があり(F20の同調の記録のため)、
    // 点数は同じ値が重複する。平均点は、学習者の発言ごとに1回だけ数える。
    const countedTurns = new Set<string>();
    for (const evaluation of evaluations ?? []) {
      if (countedTurns.has(evaluation.dialogue_turn_id)) continue;
      countedTurns.add(evaluation.dialogue_turn_id);
      const studentId = turnStudentByTurnId.get(evaluation.dialogue_turn_id);
      const stat = studentId ? stats.get(studentId) : undefined;
      if (!studentId || !stat) continue;
      const sum = sums.get(studentId) ?? { logic: 0, evidence: 0, rebuttal: 0 };
      sum.logic += evaluation.logic_structure;
      sum.evidence += evaluation.evidence_quality;
      sum.rebuttal += evaluation.rebuttal_response;
      sums.set(studentId, sum);
      stat.evaluationCount += 1;
    }
    for (const stat of stats.values()) {
      const sum = sums.get(stat.studentId);
      if (!sum || stat.evaluationCount === 0) continue;
      const n = stat.evaluationCount;
      stat.axisAvg = { logic: sum.logic / n, evidence: sum.evidence / n, rebuttal: sum.rebuttal / n };
      stat.avgScore = (stat.axisAvg.logic + stat.axisAvg.evidence + stat.axisAvg.rebuttal) / 3;
    }
  }

  // F09で生成済みのプロファイルの得意な点・課題(ここでは生成しない。教師がstudents/で押したときだけ生成する)。
  if (studentIds.length > 0) {
    const { data: profiles } = await admin
      .from("student_profiles")
      .select("student_id, strengths, challenges")
      .eq("course_id", courseId)
      .eq("status", "done")
      .in("student_id", studentIds);
    for (const profile of profiles ?? []) {
      const stat = stats.get(profile.student_id);
      if (stat) {
        stat.strengths = profile.strengths;
        stat.challenges = profile.challenges;
      }
    }
  }

  // 学習の流れ(インプット/アウトプット)の進み具合。
  const { data: stepRows } = await admin.from("course_steps").select("id").eq("course_id", courseId);
  const stepsTotal = stepRows?.length ?? 0;
  if (stepsTotal > 0 && studentIds.length > 0) {
    const { data: progress } = await admin
      .from("step_progress")
      .select("student_id")
      .in("step_id", (stepRows ?? []).map((r) => r.id))
      .in("student_id", studentIds);
    for (const row of progress ?? []) {
      const stat = stats.get(row.student_id);
      if (stat) stat.stepsDone += 1;
    }
  }

  const names = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: profileRows } = await admin.from("profiles").select("id, display_name, email").in("id", studentIds);
    for (const profile of profileRows ?? []) {
      names.set(profile.id, profile.display_name || profile.email || "(名称未設定)");
    }
  }

  const statList = studentIds
    .map((id) => stats.get(id)!)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  return { stats: statList, names, turnIds, stepsTotal };
}
