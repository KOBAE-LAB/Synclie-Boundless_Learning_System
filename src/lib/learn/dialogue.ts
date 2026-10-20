// F05の対話(学習者の発言を保存し、擬似メンバーが返答する)の中核処理。
// "use server"のactions.tsはasync関数以外をexportできず、さらにストリーミング用のAPI
// (app/api/learn/[courseId]/message/route.ts)からも同じ処理を呼びたいため、ここに切り出した。
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { searchMaterialChunks } from "@/lib/rag/search";
import { askPersona, askPersonaStream, type PersonaProfile, type ChatTurn } from "@/lib/ai/persona";
import { askScene, maxMessagesFor, type ScenePersona } from "@/lib/ai/persona-scene";
import { evaluateArgument } from "@/lib/ai/argument-evaluation";
import { isEnrolled } from "@/lib/courses/enrollment";
import { isPersonaMentioned } from "@/lib/persona-mention";
import { buildCourseContext, reasoningEffortFor } from "@/lib/courses/settings";
import { assertDiscussionAllowed, hasLaterOutput, stepContextFor, withStepContext } from "@/lib/flow/load";
import { judgeDiscussionState } from "@/lib/ai/discussion-wrapup";
import { THINKING_DEPTH_GUIDANCE, normalizeThinkingDepth } from "@/lib/persona-traits";
import { getTimeStatus, shouldJudgeDiscussionState } from "@/lib/learn/session-end";

export type AdminClient = ReturnType<typeof createAdminClient>;

// LLMに渡す直近の対話ログの件数。全履歴を渡すとコストが際限なく増えるため絞る
// (要件定義書10章「コスト」: 段階0〜1は呼び出し回数・トークン量を絞る方針)。
export const HISTORY_LIMIT = 10;

// AUTO_CONTINUE_CAP(学習者が沈黙している間、擬似メンバー同士の会話を自動継続する
// 回数の上限)は src/lib/discussion-tempo.ts で定義している。「自分の発言を待たずに
// AI同士が語るのも自然」という要望と、「無制限だと授業時間を消費してコストも際限なく
// なる」という懸念の両方を踏まえた上限で、page.tsx側の表示にも同じ値を使うが、
// "use server"ファイルはasync関数以外をexportできないためここでは再exportしない。

export interface ActivePersonaRow {
  id: string;
  name: string;
  profile: { role?: string; tone?: string } | null;
  stance: { position?: string; goal?: string } | null;
  behavior_rules: {
    speakingFrequency?: string;
    teachingDegree?: string;
    interventionCondition?: string;
    thinkingDepth?: string;
    replyTempo?: string;
  } | null;
}

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  close_suggested_at: string | null;
  close_suggest_after_turn: number;
}

const SESSION_COLUMNS = "id, started_at, ended_at, close_suggested_at, close_suggest_after_turn";

/** セッションのIDだけが要る呼び出し用。終了済みの議論への発言などは、既定では拒否する。 */
export async function getOrCreateSession(
  admin: AdminClient,
  courseId: string,
  studentId: string,
  options: { allowEnded?: boolean } = {},
): Promise<string> {
  return (await getOrCreateSessionRow(admin, courseId, studentId, options)).id;
}

// 議論の「終わり」(0032): 直近のセッションが終了済みなら、新しい議論を勝手に始めず、
// 既定ではエラーにする(終了後に発言できてしまうと、制限時間やまとめの意味がなくなるため)。
// 成果の提出やテンポ設定の保存のように、終了後も必要な操作だけ allowEnded で通す。
export async function getOrCreateSessionRow(
  admin: AdminClient,
  courseId: string,
  studentId: string,
  options: { allowEnded?: boolean } = {},
): Promise<SessionRow> {
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
  // あることを保証しているとみなし、承認済みの参加登録が無ければここで自動的に作る。
  if (!(await isEnrolled(admin, courseId, studentId))) {
    if (ltiResourceLinkId) {
      await admin
        .from("course_enrollments")
        .upsert(
          { course_id: courseId, student_id: studentId, status: "approved" },
          { onConflict: "course_id,student_id" },
        );
    } else {
      throw new Error("この授業への参加登録がありません。授業コードで申請し、先生の承認を受けてから発言してください。");
    }
  }

  const { data: latest } = await admin
    .from("learning_sessions")
    .select(SESSION_COLUMNS)
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest) {
    if (latest.ended_at && !options.allowEnded) {
      throw new Error("この議論は終了しました。議論のまとめを確認して、成果を提出しましょう。");
    }
    return latest as SessionRow;
  }

  // F19: 授業(courses.mode)が独習モードなら、セッションもsolo_studyとして作る。
  const { data: course } = await admin.from("courses").select("mode").eq("id", courseId).maybeSingle();
  const mode = course?.mode === "solo_study" ? "solo_study" : "group";

  const { data: created, error } = await admin
    .from("learning_sessions")
    .insert({ course_id: courseId, student_id: studentId, mode, lti_resource_link_id: ltiResourceLinkId })
    .select(SESSION_COLUMNS)
    .single();
  if (error || !created) {
    throw new Error(`学習セッションの作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
  }
  return created as SessionRow;
}

// F04で「使用中」にした擬似メンバーの中から、次に発言する1人を選ぶ。
// 単純な「発言が少ない順」の均等割りだけだと、複数人いる時に機械的な順番待ちに
// 見えて不自然だという指摘を受け、(1)学習者の発言で名指しされたペルソナがいれば
// それを優先し、(2)無ければ発言が少ないペルソナの中からランダムに選ぶ
// (同数のペルソナが常に同じ順で選ばれる「順番に発言している」感じを崩すため)。
// 戻り値には、選ばれなかった他の使用中ペルソナも含める(他の参加者の立場を
// 本人の発言生成時に伝え、根拠のある反論ができるようにするため)。
export async function pickRespondingPersona(
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

export function buildBehaviorNotes(rules: ActivePersonaRow["behavior_rules"]): string | undefined {
  if (!rules) return undefined;
  const lines: string[] = [];
  if (rules.speakingFrequency) lines.push(`- 発言頻度: ${rules.speakingFrequency}`);
  if (rules.teachingDegree) lines.push(`- 教える度合い: ${rules.teachingDegree}`);
  if (rules.interventionCondition) lines.push(`- 介入の条件: ${rules.interventionCondition}`);
  lines.push(`- 考え方: ${THINKING_DEPTH_GUIDANCE[normalizeThinkingDepth(rules.thinkingDepth)]}`);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

// F05/F12/F13共通: 学習者の発言(テキスト、または手書き・音声の確定分)を保存し、
// 授業RAG(F02)から関連資料を検索したうえで、使用中のペルソナ(F04)に1回だけ発言させる。
// sourceはF12(手書き)/F13(音声)用: 確定した発言がどの入力手段由来かを記録する。
/** 使用中のペルソナの行を、場面の生成(persona-scene.ts)に渡す形にする。 */
export function toScenePersona(p: ActivePersonaRow): ScenePersona {
  return {
    id: p.id,
    name: p.name,
    role: p.profile?.role ?? "",
    tone: p.profile?.tone ?? "",
    position: p.stance?.position ?? "",
    goal: p.stance?.goal ?? "",
    speakingFrequency: p.behavior_rules?.speakingFrequency ?? "普通",
    teachingDegree: p.behavior_rules?.teachingDegree ?? "問い返すのみ",
    interventionCondition: p.behavior_rules?.interventionCondition ?? "",
    thinkingDepth: normalizeThinkingDepth(p.behavior_rules?.thinkingDepth),
  };
}

// 返答をストリーミングで画面に見せたい時(app/api/learn/[courseId]/message/route.ts)に、
// 処理の途中経過を受け取るための通知。渡さなければ(手書き・音声の確定など)従来どおり、
// 全部できてから返る。
export type DialogueEvent =
  | { type: "persona"; id: string; name: string } // 誰が返答するか決まった
  | { type: "reply"; text: string } // 返答本文のここまでの全文(擬似メンバーが1人の授業)
  // 擬似メンバーが複数いる授業の「場面」: 話者が確定したメッセージの、ここまでの全部
  | { type: "scene"; messages: Array<{ personaId: string; name: string; text: string }> };

export async function postStudentMessageAndRespond(
  admin: AdminClient,
  courseId: string,
  studentId: string,
  message: string,
  source: { kind: "text" | "handwriting" | "audio"; sourcePath?: string } = { kind: "text" },
  options: { onEvent?: (event: DialogueEvent) => void } = {},
) {
  // 授業の存在確認と、セッションの取得(参加登録の確認を含む)は互いに独立なので並行して行う。
  const [{ data: course }, session] = await Promise.all([
    admin
      .from("courses")
      .select("id, title, objective, learner_level, discussion_style, time_limit_minutes, time_limit_policy, ai_close_suggestion, discussion_liveliness, reasoning_depth")
      .eq("id", courseId)
      .maybeSingle(),
    getOrCreateSessionRow(admin, courseId, studentId),
  ]);
  if (!course) {
    throw new Error("授業が見つかりません。");
  }
  const sessionId = session.id;

  // 学習の流れ(インプット/アウトプット)。順番を強制する授業では、インプットの間は議論に入れない。
  const flow = await assertDiscussionAllowed(admin, courseId, studentId);
  const stepContext = stepContextFor(flow);
  // この先にアウトプットが残っているうちは、AIが「まとめましょう」と議論の終了を急がない(時間切れは別)。
  const moreOutputsAhead = hasLaterOutput(flow.steps, flow.doneIds);

  // 制限時間(教師の設定が「超過したら発言を止める」の時だけ、ここで止める)。
  const timeStatus = getTimeStatus({
    startedAt: session.started_at,
    limitMinutes: course.time_limit_minutes,
    policy: course.time_limit_policy,
  });
  if (timeStatus.blocksInput) {
    throw new Error("制限時間を過ぎました。「まとめに進む」を押して、議論のまとめを確認しましょう。");
  }

  // 学習者の発言の保存と、誰が返答するかの選択も互いに独立(選択は発言の本文だけを使う)。
  const [studentTurnResult, picked] = await Promise.all([
    admin
      .from("dialogue_turns")
      .insert({
        session_id: sessionId,
        speaker_type: "student",
        content: message,
        source_kind: source.kind,
        source_path: source.sourcePath ?? null,
      })
      .select("id")
      .single(),
    pickRespondingPersona(admin, courseId, sessionId, message),
  ]);
  const { data: studentTurn, error: studentTurnError } = studentTurnResult;
  if (studentTurnError || !studentTurn) {
    throw new Error(`発言の保存に失敗しました: ${studentTurnError?.message ?? "不明なエラー"}`);
  }

  if (!picked) {
    // 使用中のペルソナがまだいない。学習者の発言だけ保存して終わる
    // (教師がF04でペルソナを承認・有効化するまで、擬似メンバーは発言しない)。
    revalidatePath(`/learn/${courseId}`);
    return;
  }
  const { chosen: persona, others } = picked;
  options.onEvent?.({ type: "persona", id: persona.id, name: persona.name });

  // 資料検索(埋め込みAPI+DB)、直近の履歴、個別最適化の提案は互いに独立なので並行して取得する
  // (以前は1つずつ待っていたため、その分だけ返答が遅れていた)。
  const [materialChunks, { data: recentTurns }, { data: personalization }, { count: studentTurnCount }] =
    await Promise.all([
    searchMaterialChunks(courseId, message),
    admin
      .from("dialogue_turns")
      .select("speaker_type, content, persona_id")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    // F11: 教師が採用(accepted)した個別最適化の提案があれば、促し方・難度・誤解回避の
    // 問いをこのターンのガイダンスに反映する(「学習内容を一方的に固定しない」ため、
    // 採用されたものだけを使い、未決定・見送りの提案は反映しない)。
    admin
      .from("personalization_suggestions")
      .select("avoid_misconception_question, prompting_adjustment, difficulty_adjustment")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .eq("status", "accepted")
      .maybeSingle(),
    // 議論の状態をAIに判定させるかを決めるための、これまでの学習者の発言数
    admin
      .from("dialogue_turns")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("speaker_type", "student"),
  ]);
  const materialText =
    materialChunks.length > 0
      ? materialChunks.map((chunk, i) => `[資料${i + 1}]\n${chunk}`).join("\n\n")
      : "(この発言に関連する資料は見つからなかった。資料にないことは断定せず、学習者に問い返すこと。)";

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
  const transcriptText = history
    .map((turn) => `${turn.role === "user" ? "学習者" : "擬似メンバー"}: ${turn.content}`)
    .join("\n");

  // 議論の「終わり」の提案(0032)。返答を待たせないよう、論証評価・返答の生成と並行して
  // 実行する(最後に待つが、通常は返答より先に終わっている)。AIが議論を止めることはせず、
  // 「まとめましょう」という提案を記録するだけ。判定は一定の発言数ごとにしか行わない(費用)。
  const closeSuggestionTask = (async () => {
    if (session.close_suggested_at) return;
    const suggest = async (reason: string) => {
      await admin
        .from("learning_sessions")
        .update({ close_suggested_at: new Date().toISOString(), close_suggestion_reason: reason })
        .eq("id", sessionId)
        .is("ended_at", null);
    };
    // 制限時間を過ぎていれば、AIを呼ばずに提案する。
    if (timeStatus.isOver) {
      await suggest("制限時間になりました。ここで議論をまとめましょう。");
      return;
    }
    if (
      !shouldJudgeDiscussionState({
        studentTurnCount: studentTurnCount ?? 0,
        suggestAfterTurn: session.close_suggest_after_turn,
        aiCloseSuggestionEnabled: course.ai_close_suggestion !== false && !moreOutputsAhead,
        alreadySuggested: false,
        ended: false,
      })
    ) {
      return;
    }
    try {
      const judgment = await judgeDiscussionState(transcriptText, course.objective);
      if (judgment.state !== "continue") {
        await suggest(judgment.reason || "議論がひと区切りついたようです。");
      }
    } catch {
      // 判定の失敗は、対話を止めない(付加的な機能のため)。
    }
  })();

  try {
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
    courseContext: withStepContext(buildCourseContext(course), stepContext),
  };

  // 返答: 擬似メンバーが1人なら従来どおり1人が答える。2人以上いる授業では、各メンバーの
  // 性格・視点・発言頻度から、AIが「誰が口を出すのが自然か」を場面ごとに決め、お互いに
  // 反応しながら続けて話す(AI同士の議論もある。最後は学習者に話を返す)。
  interface Reply {
    personaId: string;
    text: string;
    conceded: boolean | null;
  }
  const replies: Reply[] = [];
  const onEvent = options.onEvent;
  const reasoningEffort = reasoningEffortFor(course.reasoning_depth);
  const activeMembers = [persona, ...others];

  try {
    if (activeMembers.length >= 2) {
      const sceneMessages = await askScene(
        {
          personas: activeMembers.map(toScenePersona),
          courseContext: withStepContext(buildCourseContext(course), stepContext),
          materialText,
          turnGuidance: guidanceLines.length > 0 ? guidanceLines.join("\n") : undefined,
          maxMessages: maxMessagesFor(course.discussion_liveliness),
          calledOut: activeMembers.filter((p) => isPersonaMentioned(p.name, message)).map((p) => p.name),
          reasoningEffort,
        },
        history,
        toScenePersona(persona),
        onEvent ? (messages) => onEvent({ type: "scene", messages }) : undefined,
      );
      for (const m of sceneMessages) replies.push({ personaId: m.personaId, text: m.reply, conceded: m.conceded });
    } else {
      const result = onEvent
        ? await askPersonaStream(personaProfile, history, (text) => onEvent({ type: "reply", text }), reasoningEffort)
        : await askPersona(personaProfile, history, reasoningEffort);
      replies.push({ personaId: persona.id, text: result.reply, conceded: result.conceded });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "不明なエラー";
    throw new Error(`擬似メンバーの発言生成に失敗しました: ${detail}`);
  }
  if (replies.length === 0) {
    throw new Error("擬似メンバーの発言を生成できませんでした。もう一度お試しください。");
  }

  // 発言は順番に1つずつ保存する(同じ瞬間の時刻になって、並び順が崩れないように)。
  // F20: 「根拠なく意見が寄った度合い」を、発言した擬似メンバーごとに記録する。新しい根拠が無い
  // (hasNewEvidence=false)のにその人が譲歩した(conceded=true)場合を unwarranted_conformity とする。
  // 論証評価の点数は学習者の発言に対するもので、どのメンバーの行にも同じ値が入る
  // (集計側は、学習者の発言ごとに1回だけ数える)。
  for (const reply of replies) {
    const { error: personaTurnError } = await admin.from("dialogue_turns").insert({
      session_id: sessionId,
      speaker_type: "persona",
      persona_id: reply.personaId,
      content: reply.text,
    });
    if (personaTurnError) {
      throw new Error(`擬似メンバーの発言保存に失敗しました: ${personaTurnError.message}`);
    }

    if (argumentScores !== null && hasNewEvidence !== null && reply.conceded !== null) {
      await admin.from("argument_evaluations").insert({
        dialogue_turn_id: studentTurn.id,
        persona_id: reply.personaId,
        logic_structure: argumentScores.logicStructure,
        evidence_quality: argumentScores.evidenceQuality,
        rebuttal_response: argumentScores.rebuttalResponse,
        has_new_evidence: hasNewEvidence,
        summary_comment: argumentScores.summaryComment,
        persona_conceded: reply.conceded,
        unwarranted_conformity: reply.conceded && !hasNewEvidence,
      });
    }
  }

  await closeSuggestionTask;

  revalidatePath(`/learn/${courseId}`);
}

