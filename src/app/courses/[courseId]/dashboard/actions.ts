"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { retryJobs, scheduleJobRun } from "@/lib/inquiry/queue";
import { generateTeacherGuidance } from "@/lib/ai/teacher-guidance";
import { formatGuidanceInput, mapIndividuals, restoreNames, type GuidanceData } from "@/lib/teacher-guidance/input";
import { loadCourseStats } from "@/lib/teacher-guidance/stats";

// 教師ダッシュボード: 「指導のヒント」。教師が明示的に押したときだけ、AIが次の指導・ファシリテーションを
// 提案する(AI呼び出しを自動化しない)。AIには学習者の氏名を送らず、データの利用に同意していない
// (撤回した)学習者は含めない。提案にとどめ、判断と実行は教師。
export async function generateTeacherGuidanceAction(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  await admin
    .from("teacher_guidance")
    .upsert({ course_id: courseId, status: "processing", error: null }, { onConflict: "course_id" });

  try {
    const { data: course } = await admin
      .from("courses")
      .select("title, objective, learner_level, discussion_style")
      .eq("id", courseId)
      .maybeSingle();
    if (!course) throw new Error("授業が見つかりません。");

    const { stats, names, turnIds } = await loadCourseStats(admin, courseId);
    if (stats.length === 0) throw new Error("まだ活動記録のある学習者がいません。");

    // 同意(撤回していない)学習者だけを対象にする。
    const { data: consents } = await admin
      .from("consent_records")
      .select("student_id")
      .in("student_id", stats.map((s) => s.studentId))
      .eq("scope", "data_use")
      .is("withdrawn_at", null);
    const consented = new Set((consents ?? []).map((c) => c.student_id));
    // 管理者の「学習者として表示」用のテスト学習者は、実在の学習者ではないので含めない。
    const { data: testRows } = await admin
      .from("profiles")
      .select("id")
      .in("id", stats.map((s) => s.studentId))
      .not("test_owner_id", "is", null);
    const testIds = new Set((testRows ?? []).map((t) => t.id));
    const targets = stats.filter((s) => consented.has(s.studentId) && !testIds.has(s.studentId));
    if (targets.length === 0) throw new Error("データの利用に同意している学習者がいません。");
    const targetIds = targets.map((s) => s.studentId);

    // 学習者が「教師に共有する」を選んだ振り返りの「迷ったこと」だけ(共有していないものは使わない)。
    const { data: submissionRows } = await admin
      .from("submissions")
      .select("id, student_id")
      .eq("course_id", courseId)
      .in("student_id", targetIds);
    const studentBySubmission = new Map((submissionRows ?? []).map((s) => [s.id, s.student_id]));
    const confusions = new Map<string, string[]>();
    if (studentBySubmission.size > 0) {
      const { data: reflections } = await admin
        .from("reflections")
        .select("submission_id, what_confused")
        .eq("shared_with_teacher", true)
        .in("submission_id", [...studentBySubmission.keys()]);
      for (const r of reflections ?? []) {
        const studentId = studentBySubmission.get(r.submission_id);
        if (!studentId || !r.what_confused) continue;
        confusions.set(studentId, [...(confusions.get(studentId) ?? []), r.what_confused]);
      }
    }

    // 議論のまとめ(closing_summary)の「次に考えたい問い」。
    const { data: sessionRows } = await admin
      .from("learning_sessions")
      .select("closing_summary")
      .eq("course_id", courseId)
      .in("student_id", targetIds)
      .not("closing_summary", "is", null);
    const discussionNextQuestions: string[] = [];
    for (const row of sessionRows ?? []) {
      const questions = (row.closing_summary as { nextQuestions?: unknown } | null)?.nextQuestions;
      if (Array.isArray(questions)) {
        for (const q of questions) if (typeof q === "string" && !discussionNextQuestions.includes(q)) discussionNextQuestions.push(q);
      }
    }

    // 擬似メンバーの挙動(根拠なく同調した割合。F20)。
    const personaRows: GuidanceData["personas"] = [];
    if (turnIds.length > 0) {
      const { data: personas } = await admin.from("personas").select("id, name").eq("course_id", courseId).eq("status", "active");
      const personaName = new Map((personas ?? []).map((p) => [p.id, p.name]));
      const { data: evals } = await admin
        .from("argument_evaluations")
        .select("persona_id, unwarranted_conformity")
        .in("dialogue_turn_id", turnIds)
        .not("persona_id", "is", null);
      const agg = new Map<string, { total: number; unwarranted: number }>();
      for (const e of evals ?? []) {
        const a = agg.get(e.persona_id as string) ?? { total: 0, unwarranted: 0 };
        a.total += 1;
        if (e.unwarranted_conformity) a.unwarranted += 1;
        agg.set(e.persona_id as string, a);
      }
      for (const [id, a] of agg) {
        const name = personaName.get(id);
        if (name) personaRows.push({ name, ...a });
      }
    }

    const { text, labelToStudentId } = formatGuidanceInput({
      course: {
        title: course.title,
        objective: course.objective,
        discussionStyle: course.discussion_style,
        learnerLevel: course.learner_level,
      },
      students: targets.map((stat) => ({ stat, confusions: (confusions.get(stat.studentId) ?? []).slice(0, 3) })),
      personas: personaRows,
      discussionNextQuestions: discussionNextQuestions.slice(0, 10),
    });

    const guidance = await generateTeacherGuidance(text);
    // AIが文中で使った仮の呼び名を、教師が分かる名前に戻して保存する(AIには氏名を送っていない)。
    const labelToName = new Map<string, string>();
    for (const [label, studentId] of labelToStudentId) labelToName.set(label, names.get(studentId) ?? "(名称未設定)");
    const restore = (t: string) => restoreNames(t, labelToName);
    const content = {
      classOverview: restore(guidance.classOverview),
      facilitation: guidance.facilitation.slice(0, 3).map(restore),
      nextActivity: restore(guidance.nextActivity),
      individuals: mapIndividuals(guidance.individuals, labelToStudentId)
        .slice(0, 4)
        .map((i) => ({ ...i, observation: restore(i.observation), suggestedAction: restore(i.suggestedAction) })),
      studentCount: targets.length,
    };
    const { error } = await admin.from("teacher_guidance").upsert(
      { course_id: courseId, status: "done", error: null, content, generated_at: new Date().toISOString() },
      { onConflict: "course_id" },
    );
    if (error) throw new Error(`保存に失敗しました: ${error.message}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin.from("teacher_guidance").upsert({ course_id: courseId, status: "failed", error: message }, { onConflict: "course_id" });
  }

  revalidatePath(`/courses/${courseId}/dashboard`);
}

// 探究の記録づくり(要件定義書14章ステップ5)で、失敗・後回しになった仕事を、もう一度処理待ちに戻して実行する。
export async function retryInquiryJobsAction(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: course } = await admin.from("courses").select("series_id").eq("id", courseId).maybeSingle();
  if (!course) throw new Error("授業が見つかりません。");
  const { data: projects } = await admin.from("inquiry_projects").select("id").eq("series_id", course.series_id);
  const retried = await retryJobs(admin, (projects ?? []).map((p) => p.id as string));
  if (retried > 0) scheduleJobRun();
  revalidatePath(`/courses/${courseId}/dashboard`);
}
