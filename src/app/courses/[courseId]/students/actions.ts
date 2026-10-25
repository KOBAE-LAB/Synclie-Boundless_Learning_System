"use server";

import { getT } from "@/lib/i18n/server";
import type { DictKey, Vars } from "@/lib/i18n/translate";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { generateStudentProfileSummary } from "@/lib/ai/student-profile";
import { generatePersonalizationSuggestions } from "@/lib/ai/personalization";

// 画面の言語でのメッセージ(エラーなど)。
async function msg(key: DictKey, vars?: Vars): Promise<string> {
  return (await getT()).t(key, vars);
}

type AdminClient = ReturnType<typeof createAdminClient>;

// F09: 学習データ蓄積(学習者プロファイル)。
// この授業でのこの学習者の提出物・AIフィードバック・振り返りを1本のテキストにまとめ、
// 得意な点・課題・学習履歴の要約を生成する。呼び出し回数を絞るため、教師が明示的に
// 「プロフィールを生成する」を押したときだけ実行する(自動生成はしない)。
async function buildActivityLog(
  admin: AdminClient,
  courseId: string,
  studentId: string,
): Promise<string> {
  const { data: submissions } = await admin
    .from("submissions")
    .select("id, content, created_at")
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (!submissions || submissions.length === 0) {
    return "";
  }

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
  const reflectionBySubmission = new Map(
    (reflectionRows ?? []).map((r) => [r.submission_id, r]),
  );

  const sections = submissions.map((submission, index) => {
    const lines = [`## ${index + 1}件目(${new Date(submission.created_at).toLocaleDateString("ja-JP")})`];
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

    return lines.join("\n");
  });

  return sections.join("\n\n");
}

export async function generateStudentProfileAction(courseId: string, studentId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  await admin.from("student_profiles").upsert(
    { student_id: studentId, course_id: courseId, status: "processing", error: null },
    { onConflict: "student_id,course_id" },
  );

  try {
    const activityLog = await buildActivityLog(admin, courseId, studentId);
    if (!activityLog) {
      throw new Error((await msg("studentActions.noRecords")));
    }

    const { strengths, challenges, summary } = await generateStudentProfileSummary(activityLog, (await getT()).lang);

    const { error } = await admin.from("student_profiles").upsert(
      {
        student_id: studentId,
        course_id: courseId,
        status: "done",
        error: null,
        strengths,
        challenges,
        summary,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,course_id" },
    );
    if (error) {
      throw new Error(await msg("studentActions.saveProfileFailed", { message: error.message }));
    }
  } catch (err) {
    // 失敗理由を保存する。ここでは投げ直さず、教師が画面上で理由を見て
    // 「再生成」できるようにする(F02/F07と同じ方針)。
    const message = err instanceof Error ? err.message : await msg("studentActions.unknown");
    await admin.from("student_profiles").upsert(
      { student_id: studentId, course_id: courseId, status: "failed", error: message },
      { onConflict: "student_id,course_id" },
    );
  }

  revalidatePath(`/courses/${courseId}/students`);
}

// F11: 個別最適化支援。F09の学習者プロファイルを入力に、4種類の支援案を生成する。
// プロファイルが無ければ先にF09で生成してもらう(個別最適化はプロファイルの要約に基づくため)。
export async function generatePersonalizationAction(courseId: string, studentId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: profile } = await admin
    .from("student_profiles")
    .select("strengths, challenges, summary, status")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!profile || profile.status !== "done" || !profile.strengths || !profile.challenges || !profile.summary) {
    throw new Error((await msg("studentActions.needProfile")));
  }

  const suggestion = await generatePersonalizationSuggestions({
    lang: (await getT()).lang,
    strengths: profile.strengths,
    challenges: profile.challenges,
    summary: profile.summary,
  });

  const { error } = await admin.from("personalization_suggestions").upsert(
    {
      student_id: studentId,
      course_id: courseId,
      avoid_misconception_question: suggestion.avoidMisconceptionQuestion,
      inquiry_theme_suggestion: suggestion.inquiryThemeSuggestion,
      prompting_adjustment: suggestion.promptingAdjustment,
      difficulty_adjustment: suggestion.difficultyAdjustment,
      status: "suggested",
      generated_at: new Date().toISOString(),
      decided_at: null,
    },
    { onConflict: "student_id,course_id" },
  );
  if (error) {
    throw new Error(await msg("studentActions.saveSuggestFailed", { message: error.message }));
  }

  revalidatePath(`/courses/${courseId}/students`);
}

// F11: 教師が提案を採用/見送りを決める
// (「受け入れるかどうかは学習者と教師が決める」要件定義書7章)。
// 採用されたものだけがF05の対話生成(turnGuidance)に反映される。
export async function decidePersonalizationAction(
  courseId: string,
  studentId: string,
  decision: "accepted" | "declined",
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { error } = await admin
    .from("personalization_suggestions")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .eq("course_id", courseId);
  if (error) {
    throw new Error(await msg("studentActions.updateFailed", { message: error.message }));
  }

  revalidatePath(`/courses/${courseId}/students`);
}
