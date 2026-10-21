"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { generateStudentProfileSummary } from "@/lib/ai/student-profile";
import { generateLearnerSuggestions } from "@/lib/ai/learner-suggestions";
import { RATING_LABELS, readAssessment } from "@/lib/portfolio/assessment";
import { loadLessonLabels } from "@/lib/courses/series";

type AdminClient = ReturnType<typeof createAdminClient>;

// F26: 横断的な学びの記録とAIフィードバック。
// F09の`buildActivityLog`(courses/[courseId]/students/actions.ts)と同じ考え方だが、
// courseIdで絞らず、学習者が関わった全ての授業の提出物・フィードバック・振り返りを
// 束ねる(SSOの永続ID(F22)で同一人物と分かることを前提に、授業をまたいで蓄積する)。
async function buildCrossCourseActivityLog(admin: AdminClient, studentId: string): Promise<string> {
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, course_id, course_label, content, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (!submissions || submissions.length === 0) {
    return "";
  }

  const courseIds = [...new Set(submissions.map((s) => s.course_id).filter((id): id is string => !!id))];
  const courseTitleById = await loadLessonLabels(admin, courseIds);

  const submissionIds = submissions.map((s) => s.id);

  const { data: feedbackRows } = await admin
    .from("submission_feedback")
    .select("submission_id, criteria_label, good_points, next_question")
    .in("submission_id", submissionIds);
  const feedbackBySubmission = new Map<string, typeof feedbackRows>();
  for (const row of feedbackRows ?? []) {
    const list = feedbackBySubmission.get(row.submission_id) ?? [];
    list.push(row);
    feedbackBySubmission.set(row.submission_id, list);
  }

  const { data: reflectionRows } = await admin
    .from("reflections")
    .select("submission_id, what_learned, what_confused, next_goal")
    .in("submission_id", submissionIds);
  const reflectionBySubmission = new Map((reflectionRows ?? []).map((r) => [r.submission_id, r]));

  // ポートフォリオの自己評価・教師のコメント、AIジャッジ(議論全体の評価。非最終)も、次の努力の手がかりにする。
  const { data: entryRows } = await admin
    .from("portfolio_entries")
    .select("submission_id, self_assessment, teacher_assessment")
    .eq("student_id", studentId)
    .in("submission_id", submissionIds);
  const entryBySubmission = new Map((entryRows ?? []).map((e) => [e.submission_id as string, e]));
  const { data: judgmentRows } = await admin
    .from("discussion_judgments")
    .select("submission_id, logic_structure, evidence_quality, rebuttal_response, summary_comment")
    .in("submission_id", submissionIds);
  const judgmentBySubmission = new Map((judgmentRows ?? []).map((j) => [j.submission_id as string, j]));

  const sections = submissions.map((submission, index) => {
    // 授業回が削除された記録は、控えの名前を使う(0042)。
    const courseTitle =
      (submission.course_id ? courseTitleById.get(submission.course_id) : undefined) ?? submission.course_label ?? "(不明な授業)";
    const lines = [
      `## ${index + 1}件目 - ${courseTitle}(${new Date(submission.created_at).toLocaleDateString("ja-JP")})`,
    ];
    lines.push(`成果: ${submission.content}`);

    const feedback = feedbackBySubmission.get(submission.id) ?? [];
    for (const item of feedback) {
      lines.push(`フィードバック(${item.criteria_label}): 良い点=${item.good_points} / 次の問い=${item.next_question}`);
    }

    const reflection = reflectionBySubmission.get(submission.id);
    if (reflection) {
      lines.push(
        `振り返り: 学んだこと=${reflection.what_learned} / 迷ったこと=${reflection.what_confused} / 次にやりたいこと=${reflection.next_goal}`,
      );
    }

    const entry = entryBySubmission.get(submission.id);
    const self = readAssessment(entry?.self_assessment);
    if (self) {
      lines.push(`本人の自己評価: ${self.rating ? RATING_LABELS[self.rating] : "(段階なし)"} ${self.comment}`.trim());
    }
    const teacher = readAssessment(entry?.teacher_assessment);
    if (teacher) {
      lines.push(`教師のコメント: ${teacher.rating ? `${RATING_LABELS[teacher.rating]} ` : ""}${teacher.comment}`.trim());
    }
    const judgment = judgmentBySubmission.get(submission.id);
    if (judgment) {
      lines.push(
        `AIジャッジ(非最終・材料): 論理構成${judgment.logic_structure}/5・根拠の質${judgment.evidence_quality}/5・反論への応答${judgment.rebuttal_response}/5 ${judgment.summary_comment}`,
      );
    }

    return lines.join("\n");
  });

  return sections.join("\n\n");
}

// F26: 学習者本人が明示的に押したときだけ生成する(F09/F23と同じくAI呼び出しを自動化しない)。
export async function generateLearnerProfileAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  await admin
    .from("learner_profiles")
    .upsert({ student_id: user.id, status: "processing", error: null }, { onConflict: "student_id" });

  try {
    const activityLog = await buildCrossCourseActivityLog(admin, user.id);
    if (!activityLog) {
      throw new Error("まだ活動記録(提出物)がありません。");
    }

    const { strengths, challenges, summary } = await generateStudentProfileSummary(activityLog);

    const { error } = await admin.from("learner_profiles").upsert(
      {
        student_id: user.id,
        status: "done",
        error: null,
        strengths,
        challenges,
        summary,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    );
    if (error) {
      throw new Error(`横断プロファイルの保存に失敗しました: ${error.message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin
      .from("learner_profiles")
      .upsert({ student_id: user.id, status: "failed", error: message }, { onConflict: "student_id" });
  }

  revalidatePath("/learn/dashboard");
}

// F26: 横断プロファイルをもとに、学習者本人にそのまま提示する提案を生成する
// (F11と異なり教師の採用は挟まない。自分ごとの提案としてダッシュボードに出すだけ)。
export async function generateLearnerSuggestionsAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("learner_profiles")
    .select("strengths, challenges, summary, status")
    .eq("student_id", user.id)
    .maybeSingle();

  if (!profile || profile.status !== "done" || !profile.strengths || !profile.challenges || !profile.summary) {
    throw new Error("先に横断的な学びの記録(F26)を生成してください。");
  }

  const suggestion = await generateLearnerSuggestions({
    strengths: profile.strengths,
    challenges: profile.challenges,
    summary: profile.summary,
  });

  const { error } = await admin.from("learner_suggestions").upsert(
    {
      student_id: user.id,
      avoid_misconception_question: suggestion.avoidMisconceptionQuestion,
      inquiry_theme_suggestion: suggestion.inquiryThemeSuggestion,
      self_regulation_tip: suggestion.selfRegulationTip,
      challenge_level_tip: suggestion.challengeLevelTip,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
  if (error) {
    throw new Error(`提案の保存に失敗しました: ${error.message}`);
  }

  revalidatePath("/learn/dashboard");
}

const SUGGESTION_PLAN_PREFIX = {
  avoid_misconception_question: "確かめてみる問い",
  inquiry_theme_suggestion: "探究してみるテーマ",
  self_regulation_tip: "意識する工夫",
  challenge_level_tip: "挑戦してみること",
} as const;

// AIの提案を、自分の学習計画(F23)に取り入れる。提案の文面はクライアントから受け取らず、
// 本人の保存済みの提案から読む(取り入れるか決めるのは本人。AIが勝手に計画に入れることはしない)。
export async function addSuggestionToPlanAction(kind: keyof typeof SUGGESTION_PLAN_PREFIX) {
  const { user } = await requireRole("student");
  if (!(kind in SUGGESTION_PLAN_PREFIX)) {
    throw new Error("提案の種類が不正です。");
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("learner_suggestions")
    .select("avoid_misconception_question, inquiry_theme_suggestion, self_regulation_tip, challenge_level_tip")
    .eq("student_id", user.id)
    .maybeSingle();
  const text = row?.[kind];
  if (!text) {
    throw new Error("提案が見つかりません。");
  }
  const content = `【${SUGGESTION_PLAN_PREFIX[kind]}】${text}`;

  // 同じ提案を二重に入れない(未完了のものが既にあれば何もしない)。
  const { data: existing } = await admin
    .from("study_plan_items")
    .select("id")
    .eq("student_id", user.id)
    .eq("content", content)
    .eq("done", false)
    .maybeSingle();
  if (!existing) {
    const { error } = await admin.from("study_plan_items").insert({ student_id: user.id, content });
    if (error) {
      throw new Error(`学習計画への追加に失敗しました: ${error.message}`);
    }
  }
  revalidatePath("/learn/dashboard");
}

// F23: 生徒ダッシュボード。「AIの提案をもとに次に取り組む学習計画を立てられる」
// (要件定義書4章)のうち、学習者自身が計画項目を追加・完了・削除できる部分。
export async function addStudyPlanItemAction(formData: FormData) {
  const { user } = await requireRole("student");
  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    throw new Error("内容を入力してください。");
  }
  const courseId = String(formData.get("courseId") ?? "").trim() || null;

  const admin = createAdminClient();
  const { error } = await admin.from("study_plan_items").insert({
    student_id: user.id,
    course_id: courseId,
    content,
  });
  if (error) {
    throw new Error(`学習計画の追加に失敗しました: ${error.message}`);
  }

  revalidatePath("/learn/dashboard");
}

async function getOwnedItem(admin: ReturnType<typeof createAdminClient>, studentId: string, itemId: string) {
  const { data: item } = await admin
    .from("study_plan_items")
    .select("id, student_id, done")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.student_id !== studentId) {
    throw new Error("学習計画の項目が見つかりません。");
  }
  return item;
}

export async function toggleStudyPlanItemAction(itemId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  const item = await getOwnedItem(admin, user.id, itemId);

  const { error } = await admin.from("study_plan_items").update({ done: !item.done }).eq("id", itemId);
  if (error) {
    throw new Error(`更新に失敗しました: ${error.message}`);
  }

  revalidatePath("/learn/dashboard");
}

export async function deleteStudyPlanItemAction(itemId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await getOwnedItem(admin, user.id, itemId);

  const { error } = await admin.from("study_plan_items").delete().eq("id", itemId);
  if (error) {
    throw new Error(`削除に失敗しました: ${error.message}`);
  }

  revalidatePath("/learn/dashboard");
}
