"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { searchMaterialChunks } from "@/lib/rag/search";
import { askPersona, type PersonaProfile, type ChatTurn } from "@/lib/ai/persona";
import { generateOutcomeFeedback } from "@/lib/ai/feedback";
import { evaluateArgument, judgeDiscussion } from "@/lib/ai/argument-evaluation";
import { recognizeHandwriting } from "@/lib/ai/handwriting";
import { transcribeAudio } from "@/lib/ai/audio";
import { AUTO_CONTINUE_CAP } from "@/lib/discussion-tempo";
import { isEnrolled } from "@/lib/courses/enrollment";
import { isPersonaMentioned } from "@/lib/persona-mention";

type AdminClient = ReturnType<typeof createAdminClient>;

// LLMに渡す直近の対話ログの件数。全履歴を渡すとコストが際限なく増えるため絞る
// (要件定義書10章「コスト」: 段階0〜1は呼び出し回数・トークン量を絞る方針)。
const HISTORY_LIMIT = 10;

// AUTO_CONTINUE_CAP(学習者が沈黙している間、擬似メンバー同士の会話を自動継続する
// 回数の上限)は src/lib/discussion-tempo.ts で定義している。「自分の発言を待たずに
// AI同士が語るのも自然」という要望と、「無制限だと授業時間を消費してコストも際限なく
// なる」という懸念の両方を踏まえた上限で、page.tsx側の表示にも同じ値を使うが、
// "use server"ファイルはasync関数以外をexportできないためここでは再exportしない。

interface ActivePersonaRow {
  id: string;
  name: string;
  profile: { role?: string; tone?: string } | null;
  stance: { position?: string; goal?: string } | null;
  behavior_rules: {
    speakingFrequency?: string;
    teachingDegree?: string;
    interventionCondition?: string;
  } | null;
}

async function getOrCreateSession(admin: AdminClient, courseId: string, studentId: string) {
  // F17: 直前のLTIローンチ(/lti/continue)がこの授業向けのリソースリンクをCookieに
  // 残していれば、そのリソースリンク経由として記録する(成績連携(AGS)用)。
  const cookieStore = await cookies();
  const activeLink = cookieStore.get("lti_active_resource_link")?.value;
  let ltiResourceLinkId: string | null = null;
  if (activeLink) {
    const [linkedCourseId, resourceLinkId] = activeLink.split(":");
    if (linkedCourseId === courseId) ltiResourceLinkId = resourceLinkId;
  }

  // F01拡張(受講登録): ページ側のrequireEnrollment()と同じ境界をサーバーアクション側にも
  // 置く(ページを経由しない直接呼び出しへの防御)。LTI経由の起動はLMS側が既に履修者で
  // あることを保証しているとみなし、参加登録が無ければここで自動的に作る。
  if (!(await isEnrolled(admin, courseId, studentId))) {
    if (ltiResourceLinkId) {
      await admin
        .from("course_enrollments")
        .upsert({ course_id: courseId, student_id: studentId }, { onConflict: "course_id,student_id" });
    } else {
      throw new Error("この授業への参加登録がありません。授業コードで参加してから発言してください。");
    }
  }

  const { data: existing } = await admin
    .from("learning_sessions")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  // F19: 授業(courses.mode)が独習モードなら、セッションもsolo_studyとして作る。
  const { data: course } = await admin.from("courses").select("mode").eq("id", courseId).maybeSingle();
  const mode = course?.mode === "solo_study" ? "solo_study" : "group";

  const { data: created, error } = await admin
    .from("learning_sessions")
    .insert({ course_id: courseId, student_id: studentId, mode, lti_resource_link_id: ltiResourceLinkId })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`学習セッションの作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
  }
  return created.id as string;
}

// F04で「使用中」にした擬似メンバーの中から、次に発言する1人を選ぶ。
// 単純な「発言が少ない順」の均等割りだけだと、複数人いる時に機械的な順番待ちに
// 見えて不自然だという指摘を受け、(1)学習者の発言で名指しされたペルソナがいれば
// それを優先し、(2)無ければ発言が少ないペルソナの中からランダムに選ぶ
// (同数のペルソナが常に同じ順で選ばれる「順番に発言している」感じを崩すため)。
// 戻り値には、選ばれなかった他の使用中ペルソナも含める(他の参加者の立場を
// 本人の発言生成時に伝え、根拠のある反論ができるようにするため)。
async function pickRespondingPersona(
  admin: AdminClient,
  courseId: string,
  sessionId: string,
  latestMessage: string,
): Promise<{ chosen: ActivePersonaRow; others: ActivePersonaRow[] } | null> {
  const { data: activePersonasData } = await admin
    .from("personas")
    .select("id, name, profile, stance, behavior_rules")
    .eq("course_id", courseId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  const activePersonas = (activePersonasData ?? []) as ActivePersonaRow[];
  if (activePersonas.length === 0) return null;
  if (activePersonas.length === 1) return { chosen: activePersonas[0], others: [] };

  // 名指しされていれば、話者調整より優先してその人に答えさせる。
  const mentioned = activePersonas.find((p) => isPersonaMentioned(p.name, latestMessage));
  if (mentioned) {
    return { chosen: mentioned, others: activePersonas.filter((p) => p.id !== mentioned.id) };
  }

  const { data: personaTurns } = await admin
    .from("dialogue_turns")
    .select("persona_id, content")
    .eq("session_id", sessionId)
    .eq("speaker_type", "persona")
    .order("created_at", { ascending: false });

  // 学習者が誰も名指ししていない場合でも、直前の擬似メンバーの発言が他のメンバーを
  // 名指しして反論・言及していれば、その名指しされた人に答えさせる。これが無いと、
  // 名指しされた本人ではなく、まだ発言していない別のメンバーが「発言が少ない順」で
  // 割り込んでしまい、話がかみ合わないまま次々に人が入れ替わって見える。
  const lastPersonaTurn = (personaTurns ?? [])[0];
  if (lastPersonaTurn) {
    const calledOut = activePersonas.find(
      (p) => p.id !== lastPersonaTurn.persona_id && isPersonaMentioned(p.name, lastPersonaTurn.content),
    );
    if (calledOut) {
      return { chosen: calledOut, others: activePersonas.filter((p) => p.id !== calledOut.id) };
    }
  }

  const turnCounts = new Map<string, number>();
  for (const persona of activePersonas) turnCounts.set(persona.id, 0);
  for (const turn of personaTurns ?? []) {
    if (turn.persona_id) {
      turnCounts.set(turn.persona_id, (turnCounts.get(turn.persona_id) ?? 0) + 1);
    }
  }

  const fewestTurns = Math.min(...activePersonas.map((p) => turnCounts.get(p.id) ?? 0));
  const candidates = activePersonas.filter((p) => (turnCounts.get(p.id) ?? 0) === fewestTurns);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { chosen, others: activePersonas.filter((p) => p.id !== chosen.id) };
}

function buildBehaviorNotes(rules: ActivePersonaRow["behavior_rules"]): string | undefined {
  if (!rules) return undefined;
  const lines: string[] = [];
  if (rules.speakingFrequency) lines.push(`- 発言頻度: ${rules.speakingFrequency}`);
  if (rules.teachingDegree) lines.push(`- 教える度合い: ${rules.teachingDegree}`);
  if (rules.interventionCondition) lines.push(`- 介入の条件: ${rules.interventionCondition}`);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

// F05/F12/F13共通: 学習者の発言(テキスト、または手書き・音声の確定分)を保存し、
// 授業RAG(F02)から関連資料を検索したうえで、使用中のペルソナ(F04)に1回だけ発言させる。
// sourceはF12(手書き)/F13(音声)用: 確定した発言がどの入力手段由来かを記録する。
async function postStudentMessageAndRespond(
  admin: AdminClient,
  courseId: string,
  studentId: string,
  message: string,
  source: { kind: "text" | "handwriting" | "audio"; sourcePath?: string } = { kind: "text" },
) {
  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) {
    throw new Error("授業が見つかりません。");
  }

  const sessionId = await getOrCreateSession(admin, courseId, studentId);

  const { data: studentTurn, error: studentTurnError } = await admin
    .from("dialogue_turns")
    .insert({
      session_id: sessionId,
      speaker_type: "student",
      content: message,
      source_kind: source.kind,
      source_path: source.sourcePath ?? null,
    })
    .select("id")
    .single();
  if (studentTurnError || !studentTurn) {
    throw new Error(`発言の保存に失敗しました: ${studentTurnError?.message ?? "不明なエラー"}`);
  }

  const picked = await pickRespondingPersona(admin, courseId, sessionId, message);
  if (!picked) {
    // 使用中のペルソナがまだいない。学習者の発言だけ保存して終わる
    // (教師がF04でペルソナを承認・有効化するまで、擬似メンバーは発言しない)。
    revalidatePath(`/learn/${courseId}`);
    return;
  }
  const { chosen: persona, others } = picked;

  const materialChunks = await searchMaterialChunks(courseId, message);
  const materialText =
    materialChunks.length > 0
      ? materialChunks.map((chunk, i) => `[資料${i + 1}]\n${chunk}`).join("\n\n")
      : "(この発言に関連する資料は見つからなかった。資料にないことは断定せず、学習者に問い返すこと。)";

  const { data: recentTurns } = await admin
    .from("dialogue_turns")
    .select("speaker_type, content, persona_id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // 複数のペルソナが同じ授業にいる場合、擬似メンバーの発言は全てrole:"assistant"に
  // なるため、話者名を先頭に付けて区別できるようにする(付けないと、他のペルソナの
  // 発言が自分自身の過去の発言に見えてしまい、反論が機能しなくなる)。
  const historyPersonaIds = [
    ...new Set((recentTurns ?? []).map((t) => t.persona_id).filter((id): id is string => !!id)),
  ];
  const { data: historyPersonaRows } =
    historyPersonaIds.length > 0
      ? await admin.from("personas").select("id, name").in("id", historyPersonaIds)
      : { data: [] };
  const historyPersonaNames = new Map((historyPersonaRows ?? []).map((p) => [p.id, p.name]));

  const history: ChatTurn[] = (recentTurns ?? [])
    .reverse()
    .map((turn) => {
      if (turn.speaker_type === "student") {
        return { role: "user" as const, content: turn.content };
      }
      const speakerName = turn.persona_id ? (historyPersonaNames.get(turn.persona_id) ?? "擬似メンバー") : "擬似メンバー";
      return { role: "assistant" as const, content: `${speakerName}: ${turn.content}` };
    });

  // F20: 論証評価(F20/F24共有コンポーネント)で、学習者の直近発言が新しい根拠・具体例を
  // 含むかを判定する。失敗しても対話自体は止めない(評価は計測のための付加情報のため)。
  let hasNewEvidence: boolean | null = null;
  let argumentScores: {
    logicStructure: number;
    evidenceQuality: number;
    rebuttalResponse: number;
    summaryComment: string;
  } | null = null;
  try {
    const transcriptText = history
      .map((turn) => `${turn.role === "user" ? "学習者" : "擬似メンバー"}: ${turn.content}`)
      .join("\n");
    const evaluation = await evaluateArgument(materialText, transcriptText);
    hasNewEvidence = evaluation.新規の根拠や具体例を含むか;
    argumentScores = {
      logicStructure: evaluation.論理構成,
      evidenceQuality: evaluation.根拠の質,
      rebuttalResponse: evaluation.反論への応答,
      summaryComment: evaluation.総評,
    };
  } catch {
    // 評価に失敗しても対話は継続する。この場合、同調の判定材料が無いため記録は行わない。
  }

  // F11: 教師が採用(accepted)した個別最適化の提案があれば、促し方・難度・誤解回避の
  // 問いをこのターンのガイダンスに反映する(「学習内容を一方的に固定しない」ため、
  // 採用されたものだけを使い、未決定・見送りの提案は反映しない)。
  const { data: personalization } = await admin
    .from("personalization_suggestions")
    .select("avoid_misconception_question, prompting_adjustment, difficulty_adjustment")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .eq("status", "accepted")
    .maybeSingle();

  const guidanceLines: string[] = [];
  if (hasNewEvidence !== null) {
    guidanceLines.push(
      hasNewEvidence
        ? "学習者の直近の発言には新しい根拠・具体例が含まれると判定された。妥当だと感じるなら少し譲歩してよい。"
        : "学習者の直近の発言には新しい根拠・具体例が含まれないと判定された。この発言だけを理由に立場を変えないこと。",
    );
  }
  if (personalization) {
    guidanceLines.push(`- 同じ誤解を避けるための問い: ${personalization.avoid_misconception_question}`);
    guidanceLines.push(`- 促し方の調整: ${personalization.prompting_adjustment}`);
    guidanceLines.push(`- 難度・足場かけの調整: ${personalization.difficulty_adjustment}`);
  }

  // 他にも使用中のペルソナがいれば、その立場を伝えておく。学習者だけでなく
  // 他の擬似メンバーの発言にも根拠なく同調しないための材料になる(反論を機能させる)。
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
    turnGuidance: guidanceLines.length > 0 ? guidanceLines.join("\n") : undefined,
    otherParticipants,
  };

  let replyText: string;
  let conceded: boolean | null = null;
  try {
    const result = await askPersona(personaProfile, history);
    replyText = result.reply;
    conceded = result.conceded;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "不明なエラー";
    throw new Error(`擬似メンバーの発言生成に失敗しました: ${detail}`);
  }

  const { error: personaTurnError } = await admin.from("dialogue_turns").insert({
    session_id: sessionId,
    speaker_type: "persona",
    persona_id: persona.id,
    content: replyText,
  });
  if (personaTurnError) {
    throw new Error(`擬似メンバーの発言保存に失敗しました: ${personaTurnError.message}`);
  }

  // F20: 「根拠なく意見が寄った度合い」を記録する。新しい根拠が無い(hasNewEvidence=false)のに
  // ペルソナが譲歩した(conceded=true)場合を unwarranted_conformity として記録する。
  if (argumentScores !== null && hasNewEvidence !== null && conceded !== null) {
    await admin.from("argument_evaluations").insert({
      dialogue_turn_id: studentTurn.id,
      persona_id: persona.id,
      logic_structure: argumentScores.logicStructure,
      evidence_quality: argumentScores.evidenceQuality,
      rebuttal_response: argumentScores.rebuttalResponse,
      has_new_evidence: hasNewEvidence,
      summary_comment: argumentScores.summaryComment,
      persona_conceded: conceded,
      unwarranted_conformity: conceded && !hasNewEvidence,
    });
  }

  revalidatePath(`/learn/${courseId}`);
}

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

  const { data: course } = await admin
    .from("courses")
    .select("auto_discussion_tempo_seconds")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return;

  // 学習者本人が自分の授業画面で上書きしていればそちらを優先し、無ければ教師の既定値を使う。
  const tempoSeconds = session.auto_discussion_tempo_seconds ?? course.auto_discussion_tempo_seconds ?? 0;
  if (!tempoSeconds || tempoSeconds <= 0) return;

  const { data: recentTurnsData } = await admin
    .from("dialogue_turns")
    .select("speaker_type, content, persona_id, auto_generated")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const recentTurns = recentTurnsData ?? [];
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
    const speakerName = turn.persona_id ? (historyPersonaNames.get(turn.persona_id) ?? "擬似メンバー") : "擬似メンバー";
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
  };

  let replyText: string;
  try {
    const result = await askPersona(personaProfile, history);
    replyText = result.reply;
  } catch {
    return; // 自動継続は失敗しても対話は止めない(学習者の操作起点ではないため)
  }

  await admin.from("dialogue_turns").insert({
    session_id: session.id,
    speaker_type: "persona",
    persona_id: persona.id,
    content: replyText,
    auto_generated: true,
  });

  revalidatePath(`/learn/${courseId}`);
}

// 「テンポ」設定: 学習者が自分の授業画面で、自動継続までの秒数を自分用に上書きする。
// 空欄にすると教師の既定値(courses.auto_discussion_tempo_seconds)に戻る。
export async function updateSessionTempoAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();

  const sessionId = await getOrCreateSession(admin, courseId, user.id);
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

// F05: 学習者の発言(タイピング)を保存し、擬似メンバーに発言させる。
export async function sendMessageAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("student");

  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    throw new Error("発言を入力してください。");
  }

  const admin = createAdminClient();
  await postStudentMessageAndRespond(admin, courseId, user.id, message);
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

  const sessionId = await getOrCreateSession(admin, courseId, user.id);

  const { error } = await admin.from("submissions").insert({
    course_id: courseId,
    student_id: user.id,
    session_id: sessionId,
    kind: "text",
    content,
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

    const { data: turnRows } = await admin
      .from("dialogue_turns")
      .select("speaker_type, content, created_at")
      .eq("session_id", submission.session_id)
      .order("created_at", { ascending: true });
    if (!turnRows || turnRows.length === 0) {
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
