"use server";

import { revalidatePath } from "next/cache";
import { forgetStudentInGroups } from "@/lib/inquiry/forget";
import { invalidateAggregatesForStudent } from "@/lib/inquiry/aggregate";
import { invalidateWideScopeForStudent, WIDE_CONSENT_SCOPE } from "@/lib/inquiry/wide-consent";
import { hasConsent } from "@/lib/consent";
import { scheduleJobRun } from "@/lib/inquiry/queue";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";

// F16: 同意の撤回(利用停止)。行は消さず withdrawn_at を立てる
// (再同意すれば /consent からいつでも使い直せる)。
export async function withdrawConsentAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { error } = await admin
    .from("consent_records")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("student_id", user.id);
  if (error) {
    throw new Error(`同意の撤回に失敗しました: ${error.message}`);
  }
  // データの利用を止めたら、他の学校で使う先輩のAIの材料からも外す
  await invalidateWideScopeForStudent(admin, user.id);

  revalidatePath("/learn/data");
}

// 他の学校で使う先輩のAIの材料にすることへの、別の同意(任意)。データ利用への同意をしている学習者だけが、できる。
export async function grantWideConsentAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  if (!(await hasConsent(admin, user.id))) {
    throw new Error("先に、データの利用に同意してください。");
  }
  const { error } = await admin.from("consent_records").upsert(
    { student_id: user.id, scope: WIDE_CONSENT_SCOPE, granted_at: new Date().toISOString(), withdrawn_at: null },
    { onConflict: "student_id,scope" },
  );
  if (error) throw new Error(`同意の記録に失敗しました: ${error.message}`);
  revalidatePath("/learn/data");
}

// 他の学校で使うことへの同意を取り消す。同意は取り消しても、同じ学校での利用(データの利用への同意)は変わらない。
// この学習者の記録から作った先輩のAIは、広い範囲から外れ、他の学校への貸し出しは止まる。
export async function withdrawWideConsentAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  const { error } = await admin
    .from("consent_records")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("student_id", user.id)
    .eq("scope", WIDE_CONSENT_SCOPE);
  if (error) throw new Error(`同意の撤回に失敗しました: ${error.message}`);
  await invalidateWideScopeForStudent(admin, user.id);
  revalidatePath("/learn/data");
}

// F16: 学習者本人のデータ削除。アカウント(profiles行、ログイン情報)自体は残し、
// 蓄積した学習データ(対話ログ・成果・フィードバック・振り返り・プロファイル)を削除する。
// 外部キーの都合上、参照される側(submissions, learning_sessions)より先に
// 参照する側(submission_feedback, reflections, dialogue_turns)を消す。
export async function deleteMyDataAction() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: submissions } = await admin
    .from("submissions")
    .select("id")
    .eq("student_id", user.id);
  const submissionIds = (submissions ?? []).map((s) => s.id);

  if (submissionIds.length > 0) {
    await admin.from("submission_feedback").delete().in("submission_id", submissionIds);
    await admin.from("reflections").delete().in("submission_id", submissionIds);
    await admin.from("discussion_judgments").delete().in("submission_id", submissionIds);
  }
  await admin.from("submissions").delete().eq("student_id", user.id);

  const { data: sessions } = await admin
    .from("learning_sessions")
    .select("id")
    .eq("student_id", user.id);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  // F12/F13: 手書き画像・音声(Storage上の実ファイル)は、DB行を消すだけでは残ってしまうため、
  // 「同意の範囲と保存期間に従って保持し、削除する」(要件定義書8章)に沿って先に消す。
  const handwritingPaths: string[] = [];
  const audioPaths: string[] = [];
  if (sessionIds.length > 0) {
    const { data: turnsWithSource } = await admin
      .from("dialogue_turns")
      .select("source_kind, source_path")
      .in("session_id", sessionIds)
      .not("source_path", "is", null);
    for (const turn of turnsWithSource ?? []) {
      if (!turn.source_path) continue;
      if (turn.source_kind === "audio") audioPaths.push(turn.source_path);
      else handwritingPaths.push(turn.source_path);
    }
  }
  const { data: handwritingUploads } = await admin
    .from("handwriting_uploads")
    .select("image_path")
    .eq("student_id", user.id);
  for (const upload of handwritingUploads ?? []) {
    if (upload.image_path) handwritingPaths.push(upload.image_path);
  }
  const { data: audioUploads } = await admin
    .from("audio_uploads")
    .select("audio_path")
    .eq("student_id", user.id);
  for (const upload of audioUploads ?? []) {
    if (upload.audio_path) audioPaths.push(upload.audio_path);
  }
  // 探究のグループの議論(0044): 議論はメンバーで共有しているので、本人の発言だけを消す
  // (本人の発言から作った抽出層も消し、残ったメンバーの記録から作り直す)。
  const { data: groupTurnSessions } = await admin.from("dialogue_turns").select("session_id").eq("author_student_id", user.id);
  const { data: groupCourses } =
    (groupTurnSessions ?? []).length > 0
      ? await admin
          .from("learning_sessions")
          .select("course_id")
          .in("id", [...new Set((groupTurnSessions ?? []).map((t) => t.session_id))])
          .is("student_id", null)
      : { data: [] as { course_id: string | null }[] };
  // 集約型(0047): この学習者の記録が材料に入っている承認済みの集約型は、下書きに戻す(個人のプロジェクトを消す前に。材料の対応が消えるため)。
  await invalidateAggregatesForStudent(admin, user.id);
  const forgotten = await forgetStudentInGroups(admin, user.id);
  handwritingPaths.push(...forgotten.handwritingPaths);
  audioPaths.push(...forgotten.audioPaths);
  if (forgotten.rebuiltProjectIds.length > 0) scheduleJobRun();

  if (handwritingPaths.length > 0) {
    await admin.storage.from("handwriting").remove([...new Set(handwritingPaths)]);
  }
  if (audioPaths.length > 0) {
    await admin.storage.from("audio").remove([...new Set(audioPaths)]);
  }
  await admin.from("handwriting_uploads").delete().eq("student_id", user.id);
  await admin.from("audio_uploads").delete().eq("student_id", user.id);

  // 教師ダッシュボードの「指導のヒント」には、この学習者に触れた文が含まれうる。個別の文だけを
  // 取り除くのは難しいため、関わった授業のヒントは丸ごと消す(教師はいつでも再生成できる)。
  const { data: involvedCourses } = await admin.from("learning_sessions").select("course_id").eq("student_id", user.id);
  const involvedCourseIds = [
    ...new Set([...(involvedCourses ?? []), ...(groupCourses ?? [])].map((c) => c.course_id).filter((id): id is string => !!id)),
  ];
  if (involvedCourseIds.length > 0) {
    await admin.from("teacher_guidance").delete().in("course_id", involvedCourseIds);
  }

  // ポートフォリオの記録は、対話セッションを参照していることがあるため、セッションより先に消す。
  await admin.from("portfolio_entries").delete().eq("student_id", user.id);
  if (sessionIds.length > 0) {
    // 発言の修正版(dialogue_turn_corrections)・論証評価は、発言と一緒に消える(外部キーの連鎖)。
    await admin.from("dialogue_turns").delete().in("session_id", sessionIds);
  }
  await admin.from("learning_sessions").delete().eq("student_id", user.id);

  // 探究プロジェクト(0042): 本人の個人プロジェクトは消し、グループのプロジェクトからは本人だけを外す。
  // 記録(セッション・成果)がプロジェクトを参照しているため、記録を消した後に行う。
  await admin.from("inquiry_project_members").delete().eq("student_id", user.id);
  await admin.from("inquiry_projects").delete().eq("solo_student_id", user.id);

  await admin.from("student_profiles").delete().eq("student_id", user.id);
  await admin.from("personalization_suggestions").delete().eq("student_id", user.id);
  await admin.from("portfolio_share_links").delete().eq("student_id", user.id);
  await admin.from("study_plan_items").delete().eq("student_id", user.id);
  // 学習の流れ(インプットの理解チェックの答えを含む)
  await admin.from("step_progress").delete().eq("student_id", user.id);
  // F26実装時に追加。
  await admin.from("learner_profiles").delete().eq("student_id", user.id);
  await admin.from("learner_suggestions").delete().eq("student_id", user.id);
  // 受講登録実装時に追加。参加登録も外し、必要なら授業コードで参加し直してもらう。
  await admin.from("series_enrollments").delete().eq("student_id", user.id);

  revalidatePath("/learn/data");
}
