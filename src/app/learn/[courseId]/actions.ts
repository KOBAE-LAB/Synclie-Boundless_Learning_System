"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { searchMaterialChunks } from "@/lib/rag/search";
import { askPersona, type PersonaProfile, type ChatTurn } from "@/lib/ai/persona";
import { generateOutcomeFeedback } from "@/lib/ai/feedback";
import { judgeDiscussion } from "@/lib/ai/argument-evaluation";
import { recognizeHandwriting } from "@/lib/ai/handwriting";
import { transcribeAudio } from "@/lib/ai/audio";
import { AUTO_CONTINUE_CAP } from "@/lib/discussion-tempo";
import { COOLDOWN_AFTER_DISMISS_TURNS } from "@/lib/learn/session-end";
import { buildCourseContext, reasoningEffortFor } from "@/lib/courses/settings";
import { loadLearnerFlow, stepContextFor, withStepContext } from "@/lib/flow/load";
import { discussionGate } from "@/lib/flow/steps";
import { askScene } from "@/lib/ai/persona-scene";
import { recordContextFor } from "@/lib/records/context";
import { applyTurnCorrections } from "@/lib/records/corrections";
import {
  HISTORY_LIMIT,
  getOrCreateSession,
  toScenePersona,
  pickRespondingPersona,
  buildBehaviorNotes,
  postStudentMessageAndRespond,
} from "@/lib/learn/dialogue";

// 「テンポ」設定: 学習者が何秒か発言しない状態が続いたら、擬似メンバー同士で
// 会話を1ターンだけ自動的に継続する(学習者本人の発言を待たない)。クライアント側の
// 沈黙タイマー(AutoDiscussionTimer)から呼ばれる。無効化されている・上限に達している・
// 対話がまだ始まっていない、のいずれかなら何もしない(エラーにはしない。学習者の
// 操作ではないため、失敗しても対話画面は静かに元のまま)。
export async function autoContinueDiscussionAction(courseId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("learning_sessions")
    .select("id, auto_discussion_tempo_seconds")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return;

  // 学習の流れ: インプットの間は、擬似メンバー同士の自動継続も行わない。
  const flow = await loadLearnerFlow(admin, courseId, user.id);
  if (!discussionGate(flow.steps, flow.doneIds, flow.inOrder).allowed) return;

  const { data: course } = await admin
    .from("courses")
    .select("auto_discussion_tempo_seconds, title, objective, learner_level, discussion_style, reasoning_depth")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return;

  // 学習者本人が自分の授業画面で上書きしていればそちらを優先し、無ければ教師の既定値を使う。
  const tempoSeconds = session.auto_discussion_tempo_seconds ?? course.auto_discussion_tempo_seconds ?? 0;
  if (!tempoSeconds || tempoSeconds <= 0) return;

  const { data: recentTurnsData } = await admin
    .from("dialogue_turns")
    .select("id, speaker_type, content, persona_id, persona_name, auto_generated")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  // 教師が監査で直した発言は、直した内容をAIに渡す(元の発言は①として残る)。
  const recentTurns = await applyTurnCorrections(admin, recentTurnsData ?? []);
  if (recentTurns.length === 0) return; // まだ誰も発言していない

  // 直近(新しい順)に自動継続の発言が何連続しているかを数え、上限に達していれば止める。
  let autoStreak = 0;
  for (const t of recentTurns) {
    if (t.speaker_type === "persona" && t.auto_generated) autoStreak++;
    else break;
  }
  if (autoStreak >= AUTO_CONTINUE_CAP) return;

  const picked = await pickRespondingPersona(admin, courseId, session.id, "");
  if (!picked) return;
  const { chosen: persona, others } = picked;

  // 新しい学習者発言は無いため、直近の学習者発言を手がかりに資料を検索する
  // (無ければ資料検索はせず「関連資料なし」として扱う)。
  const lastStudentTurn = recentTurns.find((t) => t.speaker_type === "student");
  const materialChunks = lastStudentTurn ? await searchMaterialChunks(courseId, lastStudentTurn.content) : [];
  const materialText =
    materialChunks.length > 0
      ? materialChunks.map((chunk, i) => `[資料${i + 1}]\n${chunk}`).join("\n\n")
      : "(この場面に関連する資料は見つからなかった。資料にないことは断定せず問い返すこと。)";

  const historyPersonaIds = [
    ...new Set(recentTurns.map((t) => t.persona_id).filter((id): id is string => !!id)),
  ];
  const { data: historyPersonaRows } =
    historyPersonaIds.length > 0
      ? await admin.from("personas").select("id, name").in("id", historyPersonaIds)
      : { data: [] };
  const historyPersonaNames = new Map((historyPersonaRows ?? []).map((p) => [p.id, p.name]));

  const history: ChatTurn[] = [...recentTurns].reverse().map((turn) => {
    if (turn.speaker_type === "student") return { role: "user" as const, content: turn.content };
    const speakerName =
      (turn.persona_id ? historyPersonaNames.get(turn.persona_id) : undefined) ?? turn.persona_name ?? "擬似メンバー";
    return { role: "assistant" as const, content: `${speakerName}: ${turn.content}` };
  });

  const otherParticipants =
    others.length > 0
      ? others
          .map(
            (p) =>
              `- ${p.name}(${p.profile?.role ?? "役割未設定"}): 立場「${p.stance?.position ?? "(未設定)"}」`,
          )
          .join("\n")
      : undefined;

  const personaProfile: PersonaProfile = {
    name: persona.name,
    role: persona.profile?.role ?? "",
    tone: persona.profile?.tone ?? "",
    stance: `立場: ${persona.stance?.position ?? "(未設定)"}\n目標: ${persona.stance?.goal ?? "(未設定)"}`,
    materialText,
    behaviorNotes: buildBehaviorNotes(persona.behavior_rules),
    turnGuidance:
      "学習者からの新しい発言はまだ無い。少し沈黙が続いたため、あなたから会話を継続する番になった。" +
      "他の参加者の発言があればそれに応答・反論してよいし、学習者に短く問いかけてもよい。",
    otherParticipants,
    courseContext: withStepContext(buildCourseContext(course), stepContextFor(flow)),
  };

  // 擬似メンバーが2人以上いる授業では、沈黙時の継続も、メンバー同士が自然にやり取りする
  // 短い場面(最大2発言、最後は学習者への問いかけ)にする。1人なら従来どおり1発言。
  let replies: string[] = [];
  const personaIdsToSave: string[] = [];
  try {
    if (others.length > 0) {
      const members = [persona, ...others];
      const messages = await askScene(
        {
          personas: members.map(toScenePersona),
          courseContext: withStepContext(buildCourseContext(course), stepContextFor(flow)),
          materialText,
          turnGuidance:
            "学習者からの新しい発言はまだ無い。少し沈黙が続いたため、擬似メンバーのほうから会話を続ける。" +
            "直前の発言に応答・反論してよいし、学習者に短く問いかけてもよい。",
          maxMessages: 2,
          calledOut: [],
          silence: true,
          reasoningEffort: reasoningEffortFor(course.reasoning_depth),
        },
        history,
        toScenePersona(persona),
      );
      for (const m of messages) {
        replies.push(m.reply);
        personaIdsToSave.push(m.personaId);
      }
    } else {
      const result = await askPersona(personaProfile, history, reasoningEffortFor(course.reasoning_depth));
      replies = [result.reply];
      personaIdsToSave.push(persona.id);
    }
  } catch {
    return; // 自動継続は失敗しても対話は止めない(学習者の操作起点ではないため)
  }

  // 1つずつ順に保存する(同じ瞬間の時刻になって、並び順が崩れないように)。
  const memberNames = new Map([persona, ...others].map((p) => [p.id, p.name]));
  for (const [i, text] of replies.entries()) {
    await admin.from("dialogue_turns").insert({
      session_id: session.id,
      speaker_type: "persona",
      persona_id: personaIdsToSave[i],
      // 擬似メンバーが消えても、誰の発言か読めるようにする控え(0042)。
      persona_name: memberNames.get(personaIdsToSave[i]) ?? null,
      content: text,
      auto_generated: true,
    });
  }

  revalidatePath(`/learn/${courseId}`);
}

// 「テンポ」設定: 学習者が自分の授業画面で、自動継続までの秒数を自分用に上書きする。
// 空欄にすると教師の既定値(courses.auto_discussion_tempo_seconds)に戻る。
export async function updateSessionTempoAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const sessionId = await getOrCreateSession(admin, courseId, user.id, { allowEnded: true });
  const raw = String(formData.get("tempoSeconds") ?? "").trim();
  const parsed = raw === "" ? null : Number(raw);
  const value = parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  const { error } = await admin
    .from("learning_sessions")
    .update({ auto_discussion_tempo_seconds: value })
    .eq("id", sessionId);
  if (error) {
    throw new Error(`テンポ設定の保存に失敗しました: ${error.message}`);
  }

  revalidatePath(`/learn/${courseId}`);
}

// 議論の「終わり」: AIが「そろそろまとめましょう」と提案したが、「もう少し続ける」を選んだ時。
// 提案を取り下げ、あと数発言は再提案しない(続ける意思を尊重し、何度も促さないため)。
export async function dismissCloseSuggestionAction(courseId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("learning_sessions")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return;

  const { count } = await admin
    .from("dialogue_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id)
    .eq("speaker_type", "student");

  await admin
    .from("learning_sessions")
    .update({
      close_suggested_at: null,
      close_suggestion_reason: null,
      close_suggest_after_turn: (count ?? 0) + COOLDOWN_AFTER_DISMISS_TURNS,
    })
    .eq("id", session.id);

  revalidatePath(`/learn/${courseId}`);
}

// F12: 手書き入力。画像をアップロードし、OpenAIのVision機能で認識する。
// 認識結果はまだ発言として確定しない(handwriting_uploadsに一時保存し、
// 学習者が画面で確認・修正してから confirmHandwritingAction で送信する)。
export async function uploadHandwritingAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("画像ファイルを選択してください。");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) {
    throw new Error("授業が見つかりません。");
  }

  const sessionId = await getOrCreateSession(admin, courseId, user.id);

  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("handwriting")
    .upload(path, buffer, { contentType: file.type });
  if (uploadError) {
    throw new Error(`画像のアップロードに失敗しました: ${uploadError.message}`);
  }

  const { data: uploadRow, error: insertError } = await admin
    .from("handwriting_uploads")
    .insert({ session_id: sessionId, student_id: user.id, image_path: path, status: "recognizing" })
    .select("id")
    .single();
  if (insertError || !uploadRow) {
    throw new Error(`アップロード記録の作成に失敗しました: ${insertError?.message ?? "不明なエラー"}`);
  }

  try {
    const recognizedText = await recognizeHandwriting(buffer.toString("base64"), file.type);
    await admin
      .from("handwriting_uploads")
      .update({ recognized_text: recognizedText, status: "ready", error: null })
      .eq("id", uploadRow.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin.from("handwriting_uploads").update({ status: "failed", error: message }).eq("id", uploadRow.id);
  }

  revalidatePath(`/learn/${courseId}`);
}

// F12: 認識結果(学習者が確認・修正したテキスト)を発言として確定する。
export async function confirmHandwritingAction(courseId: string, uploadId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from("handwriting_uploads")
    .select("id, student_id, image_path, status")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.student_id !== user.id) {
    throw new Error("アップロードが見つかりません。");
  }
  if (upload.status !== "ready") {
    throw new Error("この画像はまだ認識結果を確認できる状態ではありません。");
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    throw new Error("発言を入力してください。");
  }

  await postStudentMessageAndRespond(admin, courseId, user.id, message, {
    kind: "handwriting",
    sourcePath: upload.image_path,
  });

  await admin.from("handwriting_uploads").update({ status: "confirmed" }).eq("id", uploadId);
}

// F12: 認識結果を使わず取り消す(画像も削除する)。
export async function discardHandwritingAction(courseId: string, uploadId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from("handwriting_uploads")
    .select("id, student_id, image_path")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.student_id !== user.id) {
    throw new Error("アップロードが見つかりません。");
  }

  await admin.storage.from("handwriting").remove([upload.image_path]);
  await admin.from("handwriting_uploads").delete().eq("id", uploadId);

  revalidatePath(`/learn/${courseId}`);
}

// F13: 音声入力。音声ファイルをアップロードし、OpenAIの文字起こし機能で認識する。
// F12(手書き)と同じ2段階フロー: audio_uploadsに一時保存し、学習者が画面で確認・修正して
// から confirmAudioAction で送信する。
export async function uploadAudioAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");

  const file = formData.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("音声ファイルを選択してください。");
  }
  if (!file.type.startsWith("audio/")) {
    throw new Error("音声ファイルを選択してください。");
  }

  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) {
    throw new Error("授業が見つかりません。");
  }

  const sessionId = await getOrCreateSession(admin, courseId, user.id);

  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from("audio")
    .upload(path, buffer, { contentType: file.type });
  if (uploadError) {
    throw new Error(`音声のアップロードに失敗しました: ${uploadError.message}`);
  }

  const { data: uploadRow, error: insertError } = await admin
    .from("audio_uploads")
    .insert({ session_id: sessionId, student_id: user.id, audio_path: path, status: "transcribing" })
    .select("id")
    .single();
  if (insertError || !uploadRow) {
    throw new Error(`アップロード記録の作成に失敗しました: ${insertError?.message ?? "不明なエラー"}`);
  }

  try {
    const transcribedText = await transcribeAudio(buffer, file.type, safeName);
    await admin
      .from("audio_uploads")
      .update({ transcribed_text: transcribedText, status: "ready", error: null })
      .eq("id", uploadRow.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin.from("audio_uploads").update({ status: "failed", error: message }).eq("id", uploadRow.id);
  }

  revalidatePath(`/learn/${courseId}`);
}

// F13: 文字起こし結果(学習者が確認・修正したテキスト)を発言として確定する。
export async function confirmAudioAction(courseId: string, uploadId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from("audio_uploads")
    .select("id, student_id, audio_path, status")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.student_id !== user.id) {
    throw new Error("アップロードが見つかりません。");
  }
  if (upload.status !== "ready") {
    throw new Error("この音声はまだ文字起こし結果を確認できる状態ではありません。");
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    throw new Error("発言を入力してください。");
  }

  await postStudentMessageAndRespond(admin, courseId, user.id, message, {
    kind: "audio",
    sourcePath: upload.audio_path,
  });

  await admin.from("audio_uploads").update({ status: "confirmed" }).eq("id", uploadId);
}

// F13: 文字起こし結果を使わず取り消す(音声ファイルも削除する)。
export async function discardAudioAction(courseId: string, uploadId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: upload } = await admin
    .from("audio_uploads")
    .select("id, student_id, audio_path")
    .eq("id", uploadId)
    .maybeSingle();
  if (!upload || upload.student_id !== user.id) {
    throw new Error("アップロードが見つかりません。");
  }

  await admin.storage.from("audio").remove([upload.audio_path]);
  await admin.from("audio_uploads").delete().eq("id", uploadId);

  revalidatePath(`/learn/${courseId}`);
}

// F06: テキスト入力(タイピングによる意見・成果の入力)。
// dialogue_turns(逐次のやり取り、F05)とは別に、議論を経て学習者がまとめた
// 「成果」そのものを submissions に保存する。F07(AIフィードバック)・F08(振り返り)は
// この成果を参照する想定。
export async function submitOutcomeAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");

  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    throw new Error("成果の内容を入力してください。");
  }

  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) {
    throw new Error("授業が見つかりません。");
  }

  const sessionId = await getOrCreateSession(admin, courseId, user.id, { allowEnded: true });
  // 生ログの保護(0042): 授業回が消えても文脈が残るよう、探究プロジェクトと授業の控えを一緒に書く。
  const context = await recordContextFor(admin, courseId, user.id);

  const { error } = await admin.from("submissions").insert({
    course_id: courseId,
    student_id: user.id,
    session_id: sessionId,
    kind: "text",
    content,
    project_id: context.projectId,
    course_label: context.courseLabel,
  });
  if (error) {
    throw new Error(`成果の提出に失敗しました: ${error.message}`);
  }

  revalidatePath(`/learn/${courseId}`);
}

// F08: 振り返り。AIフィードバック(F07)を読んだうえで、学んだこと・迷ったこと・
// 次にやりたいことを記述する。1提出物につき1件(再提出時は上書き)。
export async function saveReflectionAction(courseId: string, submissionId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id, student_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId || submission.student_id !== user.id) {
    throw new Error("成果が見つかりません。");
  }

  const whatLearned = String(formData.get("whatLearned") ?? "").trim();
  const whatConfused = String(formData.get("whatConfused") ?? "").trim();
  const nextGoal = String(formData.get("nextGoal") ?? "").trim();
  if (!whatLearned || !whatConfused || !nextGoal) {
    throw new Error("学んだこと・迷ったこと・次にやりたいことを、すべて入力してください。");
  }
  const sharedWithTeacher = formData.get("sharedWithTeacher") === "on";

  const { error } = await admin.from("reflections").upsert(
    {
      submission_id: submissionId,
      student_id: user.id,
      what_learned: whatLearned,
      what_confused: whatConfused,
      next_goal: nextGoal,
      shared_with_teacher: sharedWithTeacher,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "submission_id" },
  );
  if (error) {
    throw new Error(`振り返りの保存に失敗しました: ${error.message}`);
  }

  revalidatePath(`/learn/${courseId}`);
  revalidatePath(`/learn/${courseId}/portfolio`);
}

// F07: F06の提出物(成果)に対して、教師が設定した観点(evaluation_criteria)ごとに
// AIフィードバック(良い点・次に考える問い・参照すべき資料の箇所)を生成する。
// 再生成時は既存の submission_feedback を削除してから作り直す(F02と同じidempotentな方針)。
export async function generateFeedbackAction(courseId: string, submissionId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id, student_id, content")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId || submission.student_id !== user.id) {
    throw new Error("成果が見つかりません。");
  }

  await admin
    .from("submissions")
    .update({ feedback_status: "processing", feedback_error: null })
    .eq("id", submissionId);

  try {
    const { data: criteria } = await admin
      .from("evaluation_criteria")
      .select("id, label, description")
      .eq("course_id", courseId)
      .order("position", { ascending: true });

    if (!criteria || criteria.length === 0) {
      throw new Error("この授業には評価の観点がまだ設定されていません。教師に設定を依頼してください。");
    }

    const materialChunks = await searchMaterialChunks(courseId, submission.content);
    const materialText =
      materialChunks.length > 0
        ? materialChunks.map((chunk, i) => `[資料${i + 1}]\n${chunk}`).join("\n\n")
        : "(この提出物に関連する資料は見つからなかった。)";

    const feedbackItems = await generateOutcomeFeedback({
      criteria: criteria.map((c) => ({ label: c.label, description: c.description })),
      submissionContent: submission.content,
      materialText,
    });

    const { error: deleteError } = await admin
      .from("submission_feedback")
      .delete()
      .eq("submission_id", submissionId);
    if (deleteError) {
      throw new Error(`既存フィードバックの削除に失敗しました: ${deleteError.message}`);
    }

    const criteriaByLabel = new Map(criteria.map((c) => [c.label, c.id]));
    const rows = feedbackItems.map((item) => ({
      submission_id: submissionId,
      criteria_id: criteriaByLabel.get(item.criteriaLabel) ?? null,
      criteria_label: item.criteriaLabel,
      good_points: item.goodPoints,
      next_question: item.nextQuestion,
      material_reference: item.materialReference,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await admin.from("submission_feedback").insert(rows);
      if (insertError) {
        throw new Error(`フィードバックの保存に失敗しました: ${insertError.message}`);
      }
    }

    await admin
      .from("submissions")
      .update({ feedback_status: "done", feedback_error: null })
      .eq("id", submissionId);
  } catch (err) {
    // ステータスを failed にして理由を保存する。ここでは投げ直さず、
    // 学習者が画面上でエラー内容を見て「再生成」できるようにする(F02と同じ方針)。
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin
      .from("submissions")
      .update({ feedback_status: "failed", feedback_error: message })
      .eq("id", submissionId);
  }

  revalidatePath(`/learn/${courseId}`);
}

// F24: 討論のAIジャッジ・評価。F20と同じ「論証評価」の枠組み(論理構成/根拠の質/
// 反論への応答)を使うが、直近の発言ではなく、この成果(F06)につながる対話セッション
// 全体を通してジャッジする(src/lib/ai/argument-evaluation.tsのjudgeDiscussion)。
// 「AIが学習者の考えを代替しない」ため、この評価は最終ではなく、学習者の自己評価(F08)・
// 教師評価の材料にとどまる。再ジャッジ時は既存のdiscussion_judgmentsを削除してから
// 作り直す(F02/F07と同じidempotentな方針)。
export async function judgeDiscussionAction(courseId: string, submissionId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("submissions")
    .select("id, course_id, student_id, content, session_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || submission.course_id !== courseId || submission.student_id !== user.id) {
    throw new Error("成果が見つかりません。");
  }

  await admin
    .from("submissions")
    .update({ judgment_status: "processing", judgment_error: null })
    .eq("id", submissionId);

  try {
    if (!submission.session_id) {
      throw new Error("この成果に紐づく対話セッションが見つかりません。");
    }

    const { data: rawTurnRows } = await admin
      .from("dialogue_turns")
      .select("id, speaker_type, content, created_at")
      .eq("session_id", submission.session_id)
      .order("created_at", { ascending: true });
    // 教師が監査で直した発言は、直した内容でジャッジする。
    const turnRows = await applyTurnCorrections(admin, rawTurnRows ?? []);
    if (turnRows.length === 0) {
      throw new Error("議論の記録がまだありません。擬似メンバーと議論してから提出してください。");
    }

    const transcriptText = turnRows
      .map((turn) => `${turn.speaker_type === "student" ? "学習者" : "擬似メンバー"}: ${turn.content}`)
      .join("\n");

    const materialChunks = await searchMaterialChunks(courseId, submission.content);
    const materialText =
      materialChunks.length > 0
        ? materialChunks.map((chunk, i) => `[資料${i + 1}]\n${chunk}`).join("\n\n")
        : "(この議論に関連する資料は見つからなかった。)";

    const judgment = await judgeDiscussion(materialText, transcriptText);

    const { error: deleteError } = await admin
      .from("discussion_judgments")
      .delete()
      .eq("submission_id", submissionId);
    if (deleteError) {
      throw new Error(`既存のジャッジの削除に失敗しました: ${deleteError.message}`);
    }

    const { error: insertError } = await admin.from("discussion_judgments").insert({
      submission_id: submissionId,
      logic_structure: judgment.論理構成,
      evidence_quality: judgment.根拠の質,
      rebuttal_response: judgment.反論への応答,
      summary_comment: judgment.総評,
    });
    if (insertError) {
      throw new Error(`ジャッジの保存に失敗しました: ${insertError.message}`);
    }

    await admin
      .from("submissions")
      .update({ judgment_status: "done", judgment_error: null })
      .eq("id", submissionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin
      .from("submissions")
      .update({ judgment_status: "failed", judgment_error: message })
      .eq("id", submissionId);
  }

  revalidatePath(`/learn/${courseId}`);
}
