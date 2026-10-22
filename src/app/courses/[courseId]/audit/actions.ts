"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { loadLatestCorrections } from "@/lib/records/corrections";
import { addMarker, removeMarker } from "@/lib/inquiry/markers";
import { enqueueJob, scheduleJobRun } from "@/lib/inquiry/queue";

// F15: 教師は擬似メンバーの発言ログを確認し、不適切・不正確な挙動を修正できる。
// 元の発言(dialogue_turns.content)は書き換えず、修正版を dialogue_turn_corrections に積む
// (生ログは書き換えない、要件定義書14章の設計原則1。0042)。画面の表示と、以後の対話でAIに渡す履歴・
// まとめ・ジャッジは最新の修正版を使う(src/lib/records/corrections.ts)ので、訂正すれば
// 擬似メンバーが同じ誤りを続けることも防げる。フラグと確認メモは、これまでどおり発言の行に持つ。
export async function updateTurnAction(courseId: string, turnId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: turn } = await admin
    .from("dialogue_turns")
    .select("id, session_id, speaker_type")
    .eq("id", turnId)
    .maybeSingle();
  if (!turn || turn.speaker_type !== "persona") {
    throw new Error("発言が見つかりません。");
  }

  const { data: session } = await admin
    .from("learning_sessions")
    .select("id, course_id, ended_at, project_id")
    .eq("id", turn.session_id)
    .maybeSingle();
  if (!session || session.course_id !== courseId) {
    throw new Error("発言が見つかりません。");
  }

  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    throw new Error("発言の内容を入力してください。");
  }
  const teacherNote = String(formData.get("teacherNote") ?? "").trim();
  const flagged = formData.get("flagged") === "on";

  // いまの表示内容(最新の修正版、無ければ元の発言)と同じなら、修正版は積まない(フラグ・メモだけ更新する)。
  const { data: original } = await admin.from("dialogue_turns").select("content").eq("id", turnId).maybeSingle();
  const latest = (await loadLatestCorrections(admin, [turnId])).get(turnId);
  const current = latest?.corrected_content ?? original?.content ?? "";
  if (content !== current) {
    const { error: correctionError } = await admin.from("dialogue_turn_corrections").insert({
      turn_id: turnId,
      corrected_content: content,
      note: teacherNote || null,
      corrected_by: user.id,
    });
    if (correctionError) {
      throw new Error(`発言の修正の保存に失敗しました: ${correctionError.message}`);
    }
  }

  const { error } = await admin
    .from("dialogue_turns")
    .update({ teacher_note: teacherNote || null, flagged_by_teacher: flagged })
    .eq("id", turnId);
  if (error) {
    throw new Error(`発言の更新に失敗しました: ${error.message}`);
  }

  // 教師の印(要件定義書14章ステップ5): 探究の大事な場面として、エピソードの抽出で優先させる。
  // 議論が終わった後に付けた場合は、その議論の抽出をもう一度積む(すでにエピソードにした範囲は重ねない)。
  if (formData.get("teacherMark") === "on") {
    await addMarker(admin, { turnId, sessionId: session.id, kind: "teacher_mark", createdBy: user.id, note: teacherNote || null });
    if (session.ended_at && session.project_id) {
      await enqueueJob(admin, { kind: "extract_session", projectId: session.project_id, sessionId: session.id, round: `teacher:${turnId}` });
      scheduleJobRun({ projectId: session.project_id });
    }
  } else {
    await removeMarker(admin, turnId, "teacher_mark");
  }

  revalidatePath(`/courses/${courseId}/audit`);
}
