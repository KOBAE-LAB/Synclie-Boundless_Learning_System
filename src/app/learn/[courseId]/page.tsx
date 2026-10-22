import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { applyTurnCorrections } from "@/lib/records/corrections";
import { requireConsent } from "@/lib/consent";
import { requireEnrollment } from "@/lib/courses/enrollment";
import { SubmitButton } from "@/components/submit-button";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { ChatComposer } from "@/components/chat-composer";
import { AutoDiscussionTimer } from "@/components/auto-discussion-timer";
import { GroupLiveRefresh } from "@/components/group-live-refresh";
import { memberAlias, resolveSessionScope, scopeSessionQuery } from "@/lib/learn/session-scope";
import { SessionControls } from "@/components/session-controls";
import { getTimeStatus } from "@/lib/learn/session-end";
import { assignPersonaTones, toneClass } from "@/lib/persona-tones";
import { normalizeReplyTempo, type ReplyTempo } from "@/lib/persona-traits";
import {
  submitOutcomeAction,
  generateFeedbackAction,
  saveReflectionAction,
  uploadHandwritingAction,
  confirmHandwritingAction,
  discardHandwritingAction,
  uploadAudioAction,
  confirmAudioAction,
  discardAudioAction,
  judgeDiscussionAction,
  autoContinueDiscussionAction,
  dismissCloseSuggestionAction,
  updateSessionTempoAction,
  toggleKeepForJuniorsAction,
  declareStageAction,
} from "./actions";
import { CANONICAL_STAGES, stageLabel } from "@/lib/inquiry/stages";
import { AUTO_CONTINUE_CAP, TEMPO_OPTIONS } from "@/lib/discussion-tempo";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { StepNumber } from "@/components/step-number";
import { loadLearnerFlow } from "@/lib/flow/load";
import { lessonName, loadLessonCrumbs } from "@/lib/courses/series";
import { canOpenStep, currentStep } from "@/lib/flow/steps";
import { FlowStepper, InputStepView, OutputStepCard } from "./flow-view";

// F25: ビデオ会議アプリの「映像」のように、背景と人物を別々の画像として重ねて見せる。
// 人物イラスト(public/avatars/*.png)は教師(ユーザー本人)がAIツールで用意したものに
// 差し替え済み。背景(教室・オフィス等の写真、public/avatars/backgrounds/)はDBに持たず、
// 人物画像のファイル名(avatar_optionsのテンプレートID)から、雰囲気が合う部屋を
// 決定的に選ぶだけの表示上の演出。
const AVATAR_BACKGROUNDS: Record<string, string> = {
  "genki-01": "elementary-classroom",
  "kokishin-02": "elementary-classroom",
  "shincho-03": "jhs-classroom",
  "kaigi-04": "jhs-classroom",
  "manabi-11": "jhs-classroom",
  "hikaeme-12": "jhs-classroom",
  "playful-15": "jhs-classroom",
  "gentle-16": "jhs-classroom",
  "debater-08": "lecture-hall",
  "sage-09": "lecture-hall",
  "analyst-06": "office",
  "warm-07": "office",
  "cheerful-13": "office",
  "mentor-05": "meeting-room",
  "critic-10": "meeting-room",
  "formal-14": "meeting-room",
};
const DEFAULT_BACKGROUND = "office";
function backgroundFor(avatarPath: string | undefined): string {
  const templateId = avatarPath?.match(/\/avatars\/([a-z0-9-]+)\.\w+$/)?.[1];
  const name = (templateId && AVATAR_BACKGROUNDS[templateId]) || DEFAULT_BACKGROUND;
  return `/avatars/backgrounds/${name}.jpg`;
}

interface DialogueTurnRow {
  id: string;
  speaker_type: "student" | "persona";
  persona_id: string | null;
  persona_name: string | null;
  author_student_id: string | null;
  content: string;
  source_kind: "text" | "handwriting" | "audio";
  auto_generated: boolean;
}

type HandwritingStatus = "recognizing" | "ready" | "failed" | "confirmed";

interface HandwritingUploadRow {
  id: string;
  recognized_text: string | null;
  status: HandwritingStatus;
  error: string | null;
}

type AudioStatus = "transcribing" | "ready" | "failed" | "confirmed";

interface AudioUploadRow {
  id: string;
  transcribed_text: string | null;
  status: AudioStatus;
  error: string | null;
}

type FeedbackStatus = "pending" | "processing" | "done" | "failed";

type JudgmentStatus = "pending" | "processing" | "done" | "failed";

interface SubmissionRow {
  id: string;
  content: string;
  created_at: string;
  feedback_status: FeedbackStatus;
  feedback_error: string | null;
  judgment_status: JudgmentStatus;
  judgment_error: string | null;
}

interface FeedbackRow {
  id: string;
  submission_id: string;
  criteria_label: string;
  good_points: string;
  next_question: string;
  material_reference: string;
}

interface JudgmentRow {
  submission_id: string;
  logic_structure: number;
  evidence_quality: number;
  rebuttal_response: number;
  summary_comment: string;
}

const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: "未生成",
  processing: "生成中",
  done: "生成済み",
  failed: "失敗",
};

const JUDGMENT_STATUS_LABELS: Record<JudgmentStatus, string> = {
  pending: "未実施",
  processing: "ジャッジ中",
  done: "実施済み",
  failed: "失敗",
};

interface ReflectionRow {
  submission_id: string;
  what_learned: string;
  what_confused: string;
  next_goal: string;
  shared_with_teacher: boolean;
}

export default async function LearnCourseSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { courseId } = await params;
  const { step: requestedStepId } = await searchParams;
  const { user } = await requireRole("student");

  const admin = createAdminClient();
  // 探究の教科・科目(0044)では、グループの共有の議論を表示する。グループに入っていなければ議論できない。
  const scope = await resolveSessionScope(admin, courseId, user.id);

  // 画面の表示に必要なデータは、依存関係のあるものだけ順番に、あとは並行して取得する
  // (以前は約15回の問い合わせを1つずつ待っていたため、発言のたびの画面更新が遅かった)。
  //
  // 第1段: 互いに独立なもの。権限の確認(同意→参加登録の順は保つ)と同時に取得する。
  // 確認で弾かれた場合は redirect が投げられ、取得した内容は使われない。
  const [
    ,
    { data: course },
    { data: session },
    { data: coursePersonaRows },
    { data: avatarOptionRows },
    { data: personalization },
    { data: submissionRows },
    flow,
    lessonCrumbs,
  ] = await Promise.all([
    (async () => {
      await requireConsent(admin, user.id);
      await requireEnrollment(admin, courseId, user.id);
    })(),
    admin
      .from("courses")
      .select(
        "id, title, subject, mode, lesson_no, auto_discussion_tempo_seconds, auto_discussion_affects_evaluation, time_limit_minutes, time_limit_policy, time_limit_affects_evaluation",
      )
      .eq("id", courseId)
      .maybeSingle(),
    scopeSessionQuery(
      admin
        .from("learning_sessions")
        .select(
          "id, started_at, ended_at, end_reason, closing_summary, close_suggested_at, close_suggestion_reason, auto_discussion_tempo_seconds, project_id",
        )
        .eq("course_id", courseId),
      scope,
    )
      // 終了した議論も取得する(終わった後も、やり取りとまとめを見られるように)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // F25: この授業のペルソナ(使用中のものを対話の相手として画面上部に大きめのアバターで
    // 常に見せる。発言ログ中のペルソナ(既にactiveでなくなった場合を含む)も名前・アバターの
    // 解決に使うため、ステータスを問わず全部まとめて1回で引く。授業のペルソナは数件程度)。
    admin
      .from("personas")
      .select("id, name, avatar_id, status, created_at, behavior_rules")
      .eq("course_id", courseId)
      .order("created_at", { ascending: true }),
    // アバター候補は全授業共通で十数件しかないため、必要分を絞らず全部引く(往復を1回減らせる)。
    admin.from("avatar_options").select("id, file_path"),
    // F11: 教師が採用した個別最適化の提案のうち、探究テーマの提案だけは学習者にも見せる
    // (促し方・難度の調整は対話生成側にだけ反映し、学習者には裏側の調整として見せない)。
    admin
      .from("personalization_suggestions")
      .select("inquiry_theme_suggestion")
      .eq("student_id", user.id)
      .eq("course_id", courseId)
      .eq("status", "accepted")
      .maybeSingle(),
    admin
      .from("submissions")
      .select("id, content, created_at, feedback_status, feedback_error, judgment_status, judgment_error")
      .eq("course_id", courseId)
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }),
    loadLearnerFlow(admin, courseId, user.id),
    loadLessonCrumbs(admin, courseId),
  ]);

  if (!course) {
    notFound();
  }

  // 学習の流れ(インプット/アウトプット)。いま開くステップを決め、インプットなら専用の画面を出す。
  const flowCurrent = currentStep(flow.steps, flow.doneIds);
  const viewingStep =
    flow.steps.length === 0
      ? null
      : requestedStepId && canOpenStep(flow.steps, flow.doneIds, requestedStepId, flow.inOrder)
        ? (flow.steps.find((s) => s.id === requestedStepId) ?? flowCurrent)
        : flowCurrent;
  if (viewingStep && viewingStep.kind === "input") {
    return (
      <InputStepView
        admin={admin}
        course={{ id: course.id, title: lessonName(course.lesson_no, course.title) }}
        trail={lessonCrumbs?.learnerTrail ?? [{ label: "授業一覧", href: "/learn" }]}
        flow={flow}
        step={viewingStep}
        studentId={user.id}
      />
    );
  }

  const submissions = (submissionRows ?? []) as SubmissionRow[];
  const submissionIds = submissions.map((s) => s.id);

  // 第2段: 第1段の結果(セッション・提出物)が要るもの同士を並行して取得する。
  const [
    turnRows,
    uploadRows,
    audioUploadRows,
    feedbackRows,
    judgmentRows,
    reflectionRows,
  ] = await Promise.all([
    session
      ? admin
          .from("dialogue_turns")
          .select("id, speaker_type, persona_id, persona_name, author_student_id, content, source_kind, auto_generated")
          .eq("session_id", session.id)
          .order("created_at", { ascending: true })
          // 教師が監査で直した発言は、直した内容を表示する(元の発言は記録として残る)。
          .then((r) => applyTurnCorrections(admin, r.data ?? []))
      : null,
    // F12: まだ送信していない(確認・修正待ちの)手書きアップロードを表示する。
    session
      ? admin
          .from("handwriting_uploads")
          .select("id, recognized_text, status, error")
          .eq("session_id", session.id)
          .neq("status", "confirmed")
          .order("created_at", { ascending: true })
          .then((r) => r.data)
      : null,
    // F13: まだ送信していない(確認・修正待ちの)音声アップロードを表示する。
    session
      ? admin
          .from("audio_uploads")
          .select("id, transcribed_text, status, error")
          .eq("session_id", session.id)
          .neq("status", "confirmed")
          .order("created_at", { ascending: true })
          .then((r) => r.data)
      : null,
    submissionIds.length > 0
      ? admin
          .from("submission_feedback")
          .select("id, submission_id, criteria_label, good_points, next_question, material_reference")
          .in("submission_id", submissionIds)
          .then((r) => r.data)
      : null,
    // F24: 討論のAIジャッジ。F20と同じ論証評価の枠組みを、議論全体を通して適用したもの。
    submissionIds.length > 0
      ? admin
          .from("discussion_judgments")
          .select("submission_id, logic_structure, evidence_quality, rebuttal_response, summary_comment")
          .in("submission_id", submissionIds)
          .then((r) => r.data)
      : null,
    submissionIds.length > 0
      ? admin
          .from("reflections")
          .select("submission_id, what_learned, what_confused, next_goal, shared_with_teacher")
          .in("submission_id", submissionIds)
          .then((r) => r.data)
      : null,
  ]);

  const turns = (turnRows ?? []) as DialogueTurnRow[];

  // 探究の記録(要件定義書14章ステップ5): いまの段階と、「後輩に残したい」の印を付けた発言。
  const [{ data: projectRow }, { data: keepRows }] = await Promise.all([
    session?.project_id
      ? admin.from("inquiry_projects").select("current_stage_key").eq("id", session.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    session
      ? admin.from("inquiry_markers").select("turn_id").eq("session_id", session.id).eq("kind", "student_keep")
      : Promise.resolve({ data: [] as { turn_id: string }[] }),
  ]);
  const currentStageKey = (projectRow?.current_stage_key as string | null | undefined) ?? null;

  // グループの議論(0044): ほかのメンバーの発言には名前を出す(抜けたメンバーの過去の発言も含む)。
  const isGroup = scope.kind === "group";
  const authorIds = [...new Set(turns.map((t) => t.author_student_id).filter((id): id is string => !!id && id !== user.id))];
  const memberIdsForNames = isGroup ? [...new Set([...scope.memberIds, ...authorIds])] : [];
  const { data: memberProfiles } =
    memberIdsForNames.length > 0
      ? await admin.from("profiles").select("id, display_name").in("id", memberIdsForNames)
      : { data: [] as { id: string; display_name: string | null }[] };
  const memberNames = new Map((memberProfiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? "メンバー"]));
  const keptTurnIds = new Set((keepRows ?? []).map((r) => r.turn_id as string));
  const pendingHandwritingUploads = (uploadRows ?? []) as HandwritingUploadRow[];
  const pendingAudioUploads = (audioUploadRows ?? []) as AudioUploadRow[];

  const feedbackBySubmission = new Map<string, FeedbackRow[]>();
  for (const row of (feedbackRows ?? []) as FeedbackRow[]) {
    const list = feedbackBySubmission.get(row.submission_id) ?? [];
    list.push(row);
    feedbackBySubmission.set(row.submission_id, list);
  }
  const judgmentBySubmission = new Map<string, JudgmentRow>();
  for (const row of (judgmentRows ?? []) as JudgmentRow[]) {
    judgmentBySubmission.set(row.submission_id, row);
  }
  const reflectionBySubmission = new Map<string, ReflectionRow>();
  for (const row of (reflectionRows ?? []) as ReflectionRow[]) {
    reflectionBySubmission.set(row.submission_id, row);
  }

  const personaNames = new Map<string, string>();
  const personaAvatarPaths = new Map<string, string>();
  // 擬似メンバーごとの色(吹き出し・映像タイル・名前)。作成順で割り当てるので、いつ見ても同じ人は同じ色。
  const personaTones = assignPersonaTones((coursePersonaRows ?? []).map((p) => p.id));
  // 返答のテンポ(すばやい/ふつう/ゆっくり)。返答が画面に出るまでの間と、文字の出る速さの個性
  const personaTempos: Record<string, ReplyTempo> = Object.fromEntries(
    (coursePersonaRows ?? []).map((p) => [
      p.id,
      normalizeReplyTempo((p.behavior_rules as { replyTempo?: string } | null)?.replyTempo),
    ]),
  );
  const activePersonas = (coursePersonaRows ?? []).filter((p) => p.status === "active");
  const activePersonaCount = activePersonas.length;
  const avatarPathById = new Map((avatarOptionRows ?? []).map((o) => [o.id, o.file_path]));
  for (const persona of coursePersonaRows ?? []) {
    personaNames.set(persona.id, persona.name);
    if (persona.avatar_id) {
      const filePath = avatarPathById.get(persona.avatar_id);
      if (filePath) personaAvatarPaths.set(persona.id, filePath);
    }
  }

  // 社会的存在感の演出用: 直近に発言した擬似メンバーを「今まさに対話している相手」として
  // 上部のアバター行で目立たせる(枠の色を変えるだけ。追加のAI呼び出しやJSは使わない)。
  const lastPersonaTurn = [...turns].reverse().find((t) => t.speaker_type === "persona");
  const lastPersonaSpeakerId = lastPersonaTurn?.persona_id ?? null;

  // 「テンポ」設定: 学習者本人の上書きが無ければ教師の既定値を使う(0/未設定=オフ)。
  // 直近の発言が自動継続(auto_generated)で何連続しているかを数え、上限に達していれば
  // これ以上は自動継続しない(学習者が発言するまで待つ)。
  const effectiveTempoSeconds =
    session?.auto_discussion_tempo_seconds ?? course.auto_discussion_tempo_seconds ?? 0;
  let autoContinueStreak = 0;
  for (const turn of [...turns].reverse()) {
    if (turn.speaker_type === "persona" && turn.auto_generated) autoContinueStreak++;
    else break;
  }
  const autoContinueCapReached = autoContinueStreak >= AUTO_CONTINUE_CAP;

  const boundSubmitOutcomeAction = submitOutcomeAction.bind(null, courseId);
  const boundUploadHandwritingAction = uploadHandwritingAction.bind(null, courseId);
  const boundUploadAudioAction = uploadAudioAction.bind(null, courseId);
  const boundUpdateSessionTempoAction = updateSessionTempoAction.bind(null, courseId);
  const boundAutoContinueAction = autoContinueDiscussionAction.bind(null, courseId);
  const boundDismissCloseAction = dismissCloseSuggestionAction.bind(null, courseId);

  // 議論の「終わり」: 終了済みか、制限時間はどうか。画面上の表示用で、発言を止める判断自体は
  // サーバー(lib/learn/dialogue.ts)が毎回行う。
  const ended = !!session?.ended_at;
  const closingSummary = (session?.closing_summary ?? null) as {
    summary?: string;
    keyPoints?: string[];
    nextQuestions?: string[];
  } | null;
  const timeStatus = session
    ? getTimeStatus({
        startedAt: session.started_at,
        limitMinutes: course.time_limit_minutes,
        policy: course.time_limit_policy,
      })
    : null;
  const seriesArchived = lessonCrumbs?.archived ?? false;
  const inputLocked = ended || seriesArchived || scope.kind === "needs_group" || (timeStatus?.blocksInput ?? false);
  const END_REASON_LABELS: Record<string, string> = {
    time_limit: "制限時間になったため",
    ai_suggested: "AIの提案に応じて",
    student: "自分で終えたため",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={lessonCrumbs?.learnerTrail ?? [{ label: "授業一覧", href: "/learn" }]} current={lessonName(course.lesson_no, course.title)} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{lessonName(course.lesson_no, course.title)}</h1>
      {course.subject && <p className="mt-1 text-sm text-ink-muted">{course.subject}</p>}
      {course.mode === "solo_study" && (
        <p className="mt-1 text-sm text-ink-muted">
          独習モード: まだ分かっていない擬似メンバーに、自分の言葉で説明してみよう。
        </p>
      )}
      <Link
        href={`/learn/${courseId}/portfolio`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        ポートフォリオを見る→
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-ink-muted">
          探究の段階: <span className="font-medium text-ink">{stageLabel(currentStageKey)}</span>
        </span>
        {!seriesArchived && (
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-muted hover:underline">段階を変える</summary>
            <form action={declareStageAction.bind(null, courseId)} className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor="stage-select" className="sr-only">
                いまの探究の段階
              </label>
              <select
                id="stage-select"
                name="stage"
                defaultValue={currentStageKey ?? CANONICAL_STAGES[0].key}
                className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs"
              >
                {CANONICAL_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <SubmitButton
                pendingText="記録中…"
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
              >
                この段階に進んだ
              </SubmitButton>
            </form>
            <p className="mt-1 text-ink-faint">段階が変わると、それまでの段階の記録がまとめられ、後輩の探究の参考になります。</p>
          </details>
        )}
      </div>

      {scope.kind === "needs_group" && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-ink">
          この探究の授業では、グループで議論します。
          {lessonCrumbs?.learnerTrail?.[1]?.href ? (
            <Link href={lessonCrumbs.learnerTrail[1].href} className="ml-1 font-medium underline">
              教科・科目の画面でグループに参加する
            </Link>
          ) : (
            "教科・科目の画面で、グループに参加してください。"
          )}
        </p>
      )}
      {scope.kind === "group" && (
        <p className="mt-3 text-sm text-ink-muted">
          グループ「<span className="font-medium text-ink">{scope.groupTitle}</span>」の議論です(
          {scope.memberIds.map((id) => (id === user.id ? "あなた" : (memberNames.get(id) ?? "メンバー"))).join("・")}
          )。都合のよいときに発言しましょう。AIの仲間は、あなたを「{memberAlias(scope.memberIds, user.id)}」と呼びます。
          {scope.theme && (
            <span className="mt-1 block">
              テーマ: <span className="text-ink">{scope.theme}</span>
            </span>
          )}
        </p>
      )}

      {flow.steps.length > 0 && <FlowStepper courseId={courseId} flow={flow} viewingId={viewingStep?.id} />}
      {viewingStep && <OutputStepCard courseId={courseId} step={viewingStep} isCurrent={flowCurrent?.id === viewingStep.id} />}

      <SessionControls
        courseId={courseId}
        elapsedMsAtRender={timeStatus ? timeStatus.elapsedMs : null}
        limitMinutes={course.time_limit_minutes}
        policy={course.time_limit_policy ?? "soft"}
        affectsEvaluation={course.time_limit_affects_evaluation === true}
        ended={ended}
        suggestionReason={!ended && session?.close_suggested_at ? (session.close_suggestion_reason ?? "議論がひと区切りついたようです。") : null}
        dismissAction={boundDismissCloseAction}
      />

      {ended && (
        <div className="mt-4 rounded-lg border border-accent p-5" id="discussion-summary">
          <h2 className="text-sm font-medium text-ink">議論のまとめ(AI)</h2>
          <p className="mt-1 text-xs text-ink-faint">
            この議論は終了しました({END_REASON_LABELS[session?.end_reason ?? ""] ?? "終了"})。
            このまとめはAIによるもので、最終的な評価ではありません。
          </p>
          {closingSummary?.summary && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{closingSummary.summary}</p>
          )}
          {closingSummary?.keyPoints && closingSummary.keyPoints.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-medium text-ink-faint">議論で出た大事な点</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                {closingSummary.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </>
          )}
          {closingSummary?.nextQuestions && closingSummary.nextQuestions.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-medium text-ink-faint">次に考えてみよう</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                {closingSummary.nextQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
          <a
            href="#submit-outcome"
            className="mt-4 inline-block rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            成果を提出する →
          </a>
        </div>
      )}

      <details className="mt-3 rounded-md border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">
          沈黙時の自動継続(テンポ)
        </summary>
        <p className="mt-2 text-xs text-ink-muted">
          発言せずにいると、擬似メンバー同士が会話を少しだけ自動的に続けます(最大
          {AUTO_CONTINUE_CAP}回)。教師の既定値:{" "}
          {course.auto_discussion_tempo_seconds
            ? TEMPO_OPTIONS.find((o) => o.value === course.auto_discussion_tempo_seconds)?.label ??
              `${course.auto_discussion_tempo_seconds}秒`
            : "オフ"}
          ・この設定は
          <span className={course.auto_discussion_affects_evaluation ? "text-warn" : ""}>
            {course.auto_discussion_affects_evaluation ? "評価の参考にされます" : "評価には使われません"}
          </span>
          (教師の設定。学習者側では変更できません)。
        </p>
        <form action={boundUpdateSessionTempoAction} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">
            自分用のテンポ(未選択なら教師の既定値を使う):
            <select
              name="tempoSeconds"
              defaultValue={session?.auto_discussion_tempo_seconds ? String(session.auto_discussion_tempo_seconds) : ""}
              className="ml-2 rounded-md border border-line px-2 py-1 text-xs bg-surface-raised"
            >
              <option value="">教師の既定値を使う</option>
              {TEMPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
          >
            保存する
          </button>
        </form>
      </details>

      {isGroup && <GroupLiveRefresh courseId={courseId} turnCount={turns.length} ended={ended} />}

      {!isGroup && effectiveTempoSeconds > 0 && !ended && (
        <AutoDiscussionTimer
          tempoSeconds={effectiveTempoSeconds}
          turnCount={turns.length}
          capReached={autoContinueCapReached}
          action={boundAutoContinueAction}
        />
      )}

      {personalization && (
        <p className="mt-4 rounded-md border border-accent bg-accent-soft px-4 py-3 text-sm text-accent">
          おすすめの探究テーマ: {personalization.inquiry_theme_suggestion}
        </p>
      )}

      {(!activePersonaCount || activePersonaCount === 0) && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          この授業にはまだ「使用中」の擬似メンバーがいません。教師がペルソナ設定画面で
          承認・有効化すると、擬似メンバーと議論できるようになります。発言は保存されます。
        </p>
      )}

      {activePersonas.length > 0 && (
        <div className="mt-6">
          {/* ビデオ会議アプリ(Teams/Zoom等)の「映像タイル」のような見た目にし、対話の
              相手とカメラ越しに向き合っている感覚を出す。背景(部屋)と人物(半身イラスト、
              透過)は別々の画像ファイルを重ねて合成する(実際のビデオ会議の背景合成と
              同じ考え方)。1人なら大きな1枚のタイル、複数人ならギャラリービュー風に
              並べ、まるで同期オンライン学習をしているような臨場感を出す。実写/3Dアバターは
              使わず、既存のイラスト画像(F25、都度生成はしない)をそのまま使う。 */}
          <div
            className={`mx-auto grid gap-3 ${
              activePersonas.length === 1
                ? "max-w-sm grid-cols-1"
                : activePersonas.length === 2 || activePersonas.length === 4
                  ? "max-w-xl grid-cols-2"
                  : "max-w-2xl grid-cols-3"
            }`}
          >
            {activePersonas.map((persona) => {
              const avatarPath = personaAvatarPaths.get(persona.id);
              // 直近に発言した相手を「発言中」として縁取りで示す。誰も発言していない
              // 開始直後は、先頭の1人を仮の相手として同じように扱う。
              const isSpeaker =
                persona.id === lastPersonaSpeakerId ||
                (!lastPersonaSpeakerId && persona.id === activePersonas[0].id);
              // 発言中のメンバーは、そのメンバーの色の枠で示す(誰が話しているかを色でも見分けられる)。
              const ringClass = isSpeaker ? "persona-ring persona-tile-speaking" : "ring-1 ring-line";
              return (
                <div
                  key={persona.id}
                  className={`relative aspect-video overflow-hidden rounded-lg bg-canvas ${toneClass(personaTones[persona.id])} ${ringClass}`}
                >
                  {/* 背景(部屋)レイヤー */}
                  <img
                    src={backgroundFor(avatarPath)}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {/* 人物レイヤー(透過)。タイル全面を覆うと顔が大写しになりすぎるため、
                      頭の頂点が画面の縦半分〜4分の3あたりに来る大きさ・位置に収め、
                      実際のビデオ通話のような「上に余白のある」構図にする。 */}
                  {avatarPath ? (
                    <img
                      src={avatarPath}
                      alt=""
                      className="avatar-idle absolute inset-x-0 bottom-0 h-[57%] w-full object-contain object-bottom"
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                      <span className="persona-chip flex aspect-square h-1/2 items-center justify-center rounded-full text-[clamp(1rem,4vw,1.75rem)] font-semibold shadow-md">
                        {persona.name.slice(0, 1)}
                      </span>
                    </span>
                  )}
                  <span className="persona-chip absolute bottom-2 left-2 max-w-[85%] truncate rounded px-2 py-0.5 text-xs font-medium">
                    {persona.name}
                  </span>
                  {isSpeaker && (
                    <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[0.6875rem] font-medium text-white">
                      <span className="persona-dot h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                      発言中
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {/* ビデオ会議アプリのライブキャプション欄のように、直近の発言をテキストでも見せる。 */}
          <div
            className={`mt-2 rounded-md px-4 py-3 text-sm ${
              lastPersonaTurn ? `persona-bubble ${toneClass(personaTones[lastPersonaTurn.persona_id ?? ""])}` : "border border-line bg-surface"
            }`}
          >
            {lastPersonaTurn ? (
              <>
                <span className="persona-name font-semibold">
                  {personaNames.get(lastPersonaTurn.persona_id ?? "") ?? "擬似メンバー"}:{" "}
                </span>
                {lastPersonaTurn.auto_generated && (
                  <span className="mr-1 text-xs text-ink-faint">(自動継続)</span>
                )}
                <span className="whitespace-pre-wrap text-ink">{lastPersonaTurn.content}</span>
              </>
            ) : (
              <span className="text-ink-muted">下から話しかけてみよう。</span>
            )}
          </div>
        </div>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">これまでのやり取り</h2>
      <div className="mt-2 space-y-4">
        {turns.map((turn) => {
          if (turn.speaker_type === "student" && isGroup && turn.author_student_id !== user.id) {
            return (
              <div key={turn.id} className="text-left">
                <p className="mb-1 text-xs font-semibold text-ink-muted">
                  {(turn.author_student_id && memberNames.get(turn.author_student_id)) ?? "メンバー"}
                </p>
                <div className="inline-block max-w-[88%] rounded-lg border border-line bg-surface px-4 py-2 text-left text-sm leading-7 text-ink">
                  {turn.source_kind === "handwriting" && <p className="mb-1 text-xs text-ink-faint">[手書きから変換]</p>}
                  {turn.source_kind === "audio" && <p className="mb-1 text-xs text-ink-faint">[音声から変換]</p>}
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
                {!seriesArchived && <KeepToggle courseId={courseId} turnId={turn.id} kept={keptTurnIds.has(turn.id)} />}
              </div>
            );
          }
          if (turn.speaker_type === "student") {
            return (
              <div key={turn.id} className="text-right">
                <div className="inline-block max-w-[88%] rounded-lg bg-accent-fill px-4 py-2 text-left text-sm leading-7 text-white">
                  {turn.source_kind === "handwriting" && (
                    <p className="mb-1 text-xs text-ink-faint">[手書きから変換]</p>
                  )}
                  {turn.source_kind === "audio" && <p className="mb-1 text-xs text-ink-faint">[音声から変換]</p>}
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
                {!seriesArchived && <KeepToggle courseId={courseId} turnId={turn.id} kept={keptTurnIds.has(turn.id)} />}
              </div>
            );
          }

          const avatarPath = turn.persona_id ? personaAvatarPaths.get(turn.persona_id) : undefined;
          const personaName = (turn.persona_id ? personaNames.get(turn.persona_id) : undefined) ?? turn.persona_name ?? "擬似メンバー";
          return (
            <div key={turn.id} className={`flex items-end gap-2 ${toneClass(turn.persona_id ? personaTones[turn.persona_id] : undefined)}`}>
              {avatarPath ? (
                <img src={avatarPath} alt="" width={40} height={40} className="h-9 w-9 shrink-0 rounded-full" />
              ) : (
                <span
                  aria-hidden="true"
                  className="persona-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                >
                  {personaName.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="persona-name mb-1 text-xs font-semibold">
                  {personaName}(AI)
                  {turn.auto_generated && <span className="ml-1 text-ink-faint">・自動継続</span>}
                </p>
                <div className="persona-bubble inline-block rounded-lg px-4 py-2 text-left text-sm leading-7 text-ink">
                  {turn.source_kind === "handwriting" && (
                    <p className="mb-1 text-xs text-ink-faint">[手書きから変換]</p>
                  )}
                  {turn.source_kind === "audio" && <p className="mb-1 text-xs text-ink-faint">[音声から変換]</p>}
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
                {!seriesArchived && <KeepToggle courseId={courseId} turnId={turn.id} kept={keptTurnIds.has(turn.id)} />}
              </div>
            </div>
          );
        })}
        {turns.length === 0 && (
          <p className="text-sm text-ink-muted">まだ発言がありません。下から発言してみましょう。</p>
        )}
      </div>

      {inputLocked ? (
        <p className="mt-6 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          {scope.kind === "needs_group"
            ? "グループに参加すると、ここで議論できます。"
            : seriesArchived
            ? "この教科・科目は終了しています。記録は見返せますが、新しい発言はできません。"
            : ended
              ? "この議論は終了しました。上の「議論のまとめ」を確認して、成果を提出しましょう。"
              : "制限時間を過ぎました。議論のまとめを作っています…"}
        </p>
      ) : (
        <ChatComposer
          courseId={courseId}
          turnCount={turns.length}
          personaAvatars={Object.fromEntries(personaAvatarPaths)}
          personaTones={personaTones}
          personaTempos={personaTempos}
        />
      )}

      {/* 議論が終わった後は、手書き・音声での発言も受け付けない(終了後は、まとめと成果の提出だけ) */}
      {!inputLocked && (
        <>
      <details className="mt-3 rounded-md border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-ink-muted">
          手書き・音声で発言する
        </summary>
        <form action={boundUploadHandwritingAction} className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">
            手書きで発言する
            <input
              name="image"
              type="file"
              accept="image/*"
              required
              className="ml-2 max-w-[14rem] text-xs text-ink-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface-raised file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink hover:file:bg-surface"
            />
          </label>
          <SubmitButton
            pendingText="読み取り中…"
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            画像を読み取る
          </SubmitButton>
        </form>

        <form action={boundUploadAudioAction} className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted">
            音声で発言する
            <input
              name="audio"
              type="file"
              accept="audio/*"
              required
              className="ml-2 max-w-[14rem] text-xs text-ink-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface-raised file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink hover:file:bg-surface"
            />
          </label>
          <SubmitButton
            pendingText="文字起こし中…"
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            音声を文字起こしする
          </SubmitButton>
        </form>
      </details>

      {pendingAudioUploads.length > 0 && (
        <ul className="mt-4 space-y-3">
          {pendingAudioUploads.map((upload) => {
            const boundConfirmAction = confirmAudioAction.bind(null, courseId, upload.id);
            const boundDiscardAction = discardAudioAction.bind(null, courseId, upload.id);
            return (
              <li
                key={upload.id}
                className="rounded-md border border-line px-4 py-3 text-sm"
              >
                {upload.status === "transcribing" && (
                  <p className="text-xs text-ink-muted">音声を文字起こししています…</p>
                )}
                {upload.status === "failed" && (
                  <>
                    <p className="text-xs text-danger">
                      文字起こしに失敗しました: {upload.error}
                    </p>
                    <form action={boundDiscardAction} className="mt-2">
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        取り消す
                      </button>
                    </form>
                  </>
                )}
                {upload.status === "ready" && (
                  <form action={boundConfirmAction} className="space-y-2">
                    <label className="block space-y-2">
                      <span className="block text-xs text-ink-muted">
                        文字起こし結果です。内容を確認・修正してから送信してください。
                      </span>
                      <textarea
                        name="message"
                        required
                        rows={3}
                        defaultValue={upload.transcribed_text ?? ""}
                        className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                      />
                    </label>
                    <div className="flex gap-2">
                      <SubmitButton
                        pendingText="送信中…"
                        className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
                      >
                        この内容で送信
                      </SubmitButton>
                    </div>
                    <ThinkingIndicator label="擬似メンバーが考えています" />
                  </form>
                )}
                {upload.status === "ready" && (
                  <form action={boundDiscardAction} className="mt-2">
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                    >
                      取り消す
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingHandwritingUploads.length > 0 && (
        <ul className="mt-4 space-y-3">
          {pendingHandwritingUploads.map((upload) => {
            const boundConfirmAction = confirmHandwritingAction.bind(null, courseId, upload.id);
            const boundDiscardAction = discardHandwritingAction.bind(null, courseId, upload.id);
            return (
              <li
                key={upload.id}
                className="rounded-md border border-line px-4 py-3 text-sm"
              >
                {upload.status === "recognizing" && (
                  <p className="text-xs text-ink-muted">画像を読み取っています…</p>
                )}
                {upload.status === "failed" && (
                  <>
                    <p className="text-xs text-danger">
                      読み取りに失敗しました: {upload.error}
                    </p>
                    <form action={boundDiscardAction} className="mt-2">
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        取り消す
                      </button>
                    </form>
                  </>
                )}
                {upload.status === "ready" && (
                  <form action={boundConfirmAction} className="space-y-2">
                    <label className="block space-y-2">
                      <span className="block text-xs text-ink-muted">
                        読み取り結果です。内容を確認・修正してから送信してください。
                      </span>
                      <textarea
                        name="message"
                        required
                        rows={3}
                        defaultValue={upload.recognized_text ?? ""}
                        className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                      />
                    </label>
                    <div className="flex gap-2">
                      <SubmitButton
                        pendingText="送信中…"
                        className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
                      >
                        この内容で送信
                      </SubmitButton>
                    </div>
                    <ThinkingIndicator label="擬似メンバーが考えています" />
                  </form>
                )}
                {upload.status === "ready" && (
                  <form action={boundDiscardAction} className="mt-2">
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                    >
                      取り消す
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
        </>
      )}

      <div className="mt-12 border-t border-line pt-8" id="submit-outcome">
        {seriesArchived ? (
          <p className="text-sm text-ink-muted">この教科・科目は終了しているため、新しい成果は提出できません。</p>
        ) : null}
        {!seriesArchived && (
          <>
        <h2 className="text-sm font-medium text-ink">
          成果を提出する
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          擬似メンバーとの議論をふまえて、自分の考えをまとめて提出しましょう。
        </p>

        <form action={boundSubmitOutcomeAction} className="mt-4 space-y-3">
          <label htmlFor="outcome-content" className="sr-only">
            成果の内容
          </label>
          <textarea
            id="outcome-content"
            name="content"
            required
            rows={4}
            placeholder="議論をふまえた自分の考えをまとめて書く"
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <button
            type="submit"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            提出する
          </button>
        </form>

          </>
        )}

        {submissions.length > 0 && (
          <ul className="mt-6 space-y-4">
            {submissions.map((submission) => {
              const boundGenerateFeedbackAction = generateFeedbackAction.bind(
                null,
                courseId,
                submission.id,
              );
              const boundSaveReflectionAction = saveReflectionAction.bind(
                null,
                courseId,
                submission.id,
              );
              const boundJudgeDiscussionAction = judgeDiscussionAction.bind(
                null,
                courseId,
                submission.id,
              );
              const feedbackItems = feedbackBySubmission.get(submission.id) ?? [];
              const reflection = reflectionBySubmission.get(submission.id);
              const judgment = judgmentBySubmission.get(submission.id);

              return (
                <li
                  key={submission.id}
                  className="rounded-md border border-line px-4 py-3 text-sm"
                >
                  <p className="whitespace-pre-wrap">{submission.content}</p>
                  <p className="mt-2 text-xs text-ink-faint">
                    {new Date(submission.created_at).toLocaleString("ja-JP")}
                  </p>
                  <ol className="mt-3 space-y-2 rounded-md bg-surface px-3 py-2" aria-label="提出したあとの流れ">
                    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs font-medium text-ink">
                        <StepNumber n={1} />
                        AIフィードバック
                        <span className="ml-2 font-normal text-ink-faint">{FEEDBACK_STATUS_LABELS[submission.feedback_status]}</span>
                      </span>
                      <form action={boundGenerateFeedbackAction}>
                        <SubmitButton
                          pendingText="生成中…"
                          className="rounded-md border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                        >
                          {submission.feedback_status === "done" ? "再生成する" : "もらう"}
                        </SubmitButton>
                      </form>
                    </li>
                    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs font-medium text-ink">
                        <StepNumber n={2} />
                        AIジャッジ(議論全体の評価・任意)
                        <span className="ml-2 font-normal text-ink-faint">{JUDGMENT_STATUS_LABELS[submission.judgment_status]}</span>
                      </span>
                      <form action={boundJudgeDiscussionAction}>
                        <SubmitButton
                          pendingText="ジャッジ中…"
                          className="rounded-md border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                        >
                          {submission.judgment_status === "done" ? "再ジャッジする" : "受ける"}
                        </SubmitButton>
                      </form>
                    </li>
                    <li className="text-xs font-medium text-ink">
                      <StepNumber n={3} />
                      振り返り
                      <span className="ml-2 font-normal text-ink-faint">
                        {reflection ? "記入済み" : submission.feedback_status === "done" ? "下の欄に書けます" : "フィードバックのあとに書けます"}
                      </span>
                    </li>
                  </ol>

                  {submission.feedback_status === "failed" && submission.feedback_error && (
                    <p className="mt-2 text-xs text-danger">
                      {submission.feedback_error}
                    </p>
                  )}
                  {submission.judgment_status === "failed" && submission.judgment_error && (
                    <p className="mt-2 text-xs text-danger">
                      {submission.judgment_error}
                    </p>
                  )}

                  {feedbackItems.length > 0 && (
                    <div className="mt-4 space-y-3 border-t border-line pt-3">
                      {feedbackItems.map((item) => (
                        <div key={item.id}>
                          <p className="text-xs font-medium text-ink-muted">
                            {item.criteria_label}
                          </p>
                          <p className="mt-1">
                            <span className="text-ink-muted">良い点: </span>
                            {item.good_points}
                          </p>
                          <p className="mt-1">
                            <span className="text-ink-muted">次に考える問い: </span>
                            {item.next_question}
                          </p>
                          <p className="mt-1 text-xs text-ink-muted">
                            参照すべき資料の箇所: {item.material_reference}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {judgment && (
                    <div className="mt-4 space-y-1 border-t border-line pt-3">
                      <p className="text-xs font-medium text-ink">
                        AIジャッジ: 議論全体を通しての評価
                      </p>
                      <p className="text-xs text-ink-muted">
                        論理構成 {judgment.logic_structure}/5 ・ 根拠の質 {judgment.evidence_quality}/5 ・
                        反論への応答 {judgment.rebuttal_response}/5
                      </p>
                      <p className="mt-1">{judgment.summary_comment}</p>
                      <p className="mt-1 text-xs text-ink-faint">
                        この評価は最終ではありません。自己評価や教師の評価の参考にしてください。
                      </p>
                    </div>
                  )}

                  {submission.feedback_status === "done" && (
                    <div className="mt-4 border-t border-line pt-3">
                      <p className="text-xs font-medium text-ink">
                        <StepNumber n={3} />
                        振り返り{reflection && "(記入済み・編集できます)"}
                      </p>
                      <form action={boundSaveReflectionAction} className="mt-2 space-y-2">
                        <label className="block">
                          <span className="sr-only">学んだこと</span>
                          <textarea
                            name="whatLearned"
                            required
                            rows={2}
                            placeholder="学んだこと"
                            defaultValue={reflection?.what_learned}
                            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                          />
                        </label>
                        <label className="block">
                          <span className="sr-only">迷ったこと</span>
                          <textarea
                            name="whatConfused"
                            required
                            rows={2}
                            placeholder="迷ったこと"
                            defaultValue={reflection?.what_confused}
                            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                          />
                        </label>
                        <label className="block">
                          <span className="sr-only">次にやりたいこと</span>
                          <textarea
                            name="nextGoal"
                            required
                            rows={2}
                            placeholder="次にやりたいこと"
                            defaultValue={reflection?.next_goal}
                            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-ink-muted">
                          <input
                            type="checkbox"
                            name="sharedWithTeacher"
                            defaultChecked={reflection?.shared_with_teacher}
                          />
                          教師に共有する
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                        >
                          {reflection ? "更新する" : "振り返りを保存"}
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <BackLink href={lessonCrumbs ? `/learn/series/${lessonCrumbs.seriesId}` : "/learn"} label={lessonCrumbs?.seriesTitle ?? "授業一覧"} />
    </div>
  );
}

// 「後輩に残したい」の印の付け外し(要件定義書14章ステップ5)。発言の下に小さく出す。
function KeepToggle({ courseId, turnId, kept }: { courseId: string; turnId: string; kept: boolean }) {
  return (
    <form action={toggleKeepForJuniorsAction.bind(null, courseId, turnId)} className="mt-0.5">
      <button
        type="submit"
        aria-pressed={kept}
        title={kept ? "印を外す" : "この場面を、後輩の探究の参考に残す"}
        className={`text-xs hover:underline ${kept ? "font-medium text-warn" : "text-ink-faint"}`}
      >
        {kept ? "★ 後輩に残す" : "☆ 後輩に残す"}
      </button>
    </form>
  );
}
