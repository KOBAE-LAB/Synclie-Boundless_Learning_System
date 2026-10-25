"use server";

import { getT } from "@/lib/i18n/server";
import type { DictKey, Vars } from "@/lib/i18n/translate";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { sendScoreToLms } from "@/lib/lti/ags";
import { parseAssessmentInput } from "@/lib/portfolio/assessment";
import { patchPortfolioEntry } from "@/lib/portfolio/entries";

// 画面の言語でのメッセージ(エラーなど)。
async function msg(key: DictKey, vars?: Vars): Promise<string> {
  return (await getT()).t(key, vars);
}

// ポートフォリオ: 教師が成果ごとに評価(段階とコメント)を書く。AIの評価は材料で、最終判断は教師と学習者。
// 学習者のポートフォリオに表示される。
export async function saveTeacherAssessmentAction(courseId: string, submissionId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id, student_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId) {
    throw new Error((await msg("subActions.subNotFound")));
  }

  const assessment = parseAssessmentInput({
    rating: String(formData.get("rating") ?? ""),
    comment: String(formData.get("comment") ?? ""),
  });
  await patchPortfolioEntry(admin, submission.student_id, submissionId, { teacher_assessment: assessment });
  revalidatePath(`/courses/${courseId}/submissions`);
}

// F07: 教師はAIが生成したフィードバックの文面を確認・修正できる(要件定義書7章)。
export async function updateFeedbackAction(
  courseId: string,
  feedbackId: string,
  formData: FormData,
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: feedback } = await admin
    .from("submission_feedback")
    .select("id, submission_id")
    .eq("id", feedbackId)
    .maybeSingle();
  if (!feedback) {
    throw new Error((await msg("subActions.fbNotFound")));
  }

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id")
    .eq("id", feedback.submission_id)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId) {
    throw new Error((await msg("subActions.fbNotFound")));
  }

  const goodPoints = String(formData.get("goodPoints") ?? "").trim();
  const nextQuestion = String(formData.get("nextQuestion") ?? "").trim();
  const materialReference = String(formData.get("materialReference") ?? "").trim();
  if (!goodPoints || !nextQuestion || !materialReference) {
    throw new Error((await msg("subActions.needAll")));
  }

  const { error } = await admin
    .from("submission_feedback")
    .update({
      good_points: goodPoints,
      next_question: nextQuestion,
      material_reference: materialReference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", feedbackId);
  if (error) {
    throw new Error(await msg("subActions.updateFailed", { message: error.message }));
  }

  revalidatePath(`/courses/${courseId}/submissions`);
}

// F17: F24の議論ジャッジ結果を、LTI経由でリンクされたLMSの成績簿へ送信する
// (成績連携、AGS)。「教師はそれをもとに学習評価を行う」(F24)の延長として、
// 教師が確認したうえで明示的に送る操作にする(自動送信はしない)。
export async function sendGradeToLmsAction(courseId: string, submissionId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id, student_id, session_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId) {
    throw new Error((await msg("subActions.workNotFound")));
  }

  const { data: judgment } = await admin
    .from("discussion_judgments")
    .select("logic_structure, evidence_quality, rebuttal_response, summary_comment")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (!judgment) {
    throw new Error((await msg("subActions.needJudge")));
  }

  if (!submission.session_id) {
    throw new Error((await msg("subActions.noSession")));
  }
  const { data: session } = await admin
    .from("learning_sessions")
    .select("lti_resource_link_id")
    .eq("id", submission.session_id)
    .maybeSingle();
  if (!session?.lti_resource_link_id) {
    throw new Error((await msg("subActions.notLti")));
  }

  const { data: link } = await admin
    .from("lti_resource_links")
    .select("lineitem_url")
    .eq("id", session.lti_resource_link_id)
    .maybeSingle();
  if (!link?.lineitem_url) {
    throw new Error((await msg("subActions.noLineitem")));
  }

  const { data: studentProfile } = await admin
    .from("profiles")
    .select("lti_subject")
    .eq("id", submission.student_id)
    .maybeSingle();
  if (!studentProfile?.lti_subject) {
    throw new Error((await msg("subActions.learnerNotLti")));
  }

  const scoreGiven =
    (judgment.logic_structure + judgment.evidence_quality + judgment.rebuttal_response) / 3;

  await sendScoreToLms({
    lineitemUrl: link.lineitem_url,
    ltiUserId: studentProfile.lti_subject,
    scoreGiven,
    scoreMaximum: 5,
    comment: judgment.summary_comment,
  });

  revalidatePath(`/courses/${courseId}/submissions`);
}
