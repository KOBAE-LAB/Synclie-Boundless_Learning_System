// 先輩型ペルソナの「記憶」を組み立てる(要件定義書14章ステップ6の検索のルール)。AIは呼ばない(埋め込みは教材の検索と共用)。
//  - 軌跡: 当時モードは後輩のいまの段階までの版、振り返りモードは振り返り版(無ければ最後の版)を、常に渡す。
//  - エピソード: 後輩の発言にいちばん近い1件を、親(その段階の物語)と一緒に添える。当時モードは後輩のいまの段階までに絞る。
//  - 何を渡したかを返し、呼び出し側が発言ごとに dialogue_turn_retrievals に記録する(先輩の発言の根拠をたどれるように)。
import type { createAdminClient } from "@/lib/supabase/server";
import { stageIndex, stageLabel, stagesUpTo } from "./stages";
import type { SeniorMode } from "./senior";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RetrievalRecord {
  kind: "trajectory" | "stage_story" | "episode" | "aggregate";
  trajectory_id?: string;
  stage_story_id?: string;
  episode_version_id?: string;
  rank?: number;
  similarity?: number;
}

export interface SeniorMemory {
  text: string;
  retrievals: RetrievalRecord[];
}

export const SENIOR_GUARDRAILS = `# 先輩の記録をもとにしたAIとしてのルール
- あなたは先輩本人ではなく、先輩の探究の記録をもとにしたAIである。聞かれたら、そう答える。
- 記録にない当時のことは、推測で補わず「そこは覚えていない」と答える。
- 自分のやり方を答えとして押し付けない。「自分のときはこうだった」を材料に、後輩に問い返す。
- 後輩の意見にも、根拠なく同調しない(新しい根拠か具体的な事例が出たときだけ、考えを少し変えてよい)。
- 人の名前・学校名・地名は話さない(記録の「〇〇」は伏せた名前なので、そのまま伏せておく)。`;

const THEN_RULE = `- いまのあなたは、後輩と同じ段階にいたときの自分として話す。自分の探究の結論や、その後の展開は話さない(まだ知らないものとして話す)。`;
const THEN_RULE_LESSON = `- いまのあなたは、後輩と同じ回(第{N}回)の頃の自分として話す。それより後の回のことや、最終的にどうなったかは話さない(まだ知らないものとして話す)。`;
const RETRO_RULE = `- いまのあなたは、探究を終えた立場から、振り返って話す。結論を先に教えるのではなく、迷いの意味を一緒に考える材料にする。`;

interface TrajectoryRow {
  id: string;
  body: string;
  version: number;
  kind: string;
  up_to_stage_key: string | null;
}

/** 当時モードで使う軌跡: 後輩のいまの段階までの版のうち、いちばん新しいもの(純粋関数)。 */
export function pickThenTrajectory(rows: TrajectoryRow[], juniorStageKey: string | null | undefined): TrajectoryRow | null {
  const limit = Math.max(0, stageIndex(juniorStageKey));
  return (
    rows
      .filter((r) => r.kind === "live" && stageIndex(r.up_to_stage_key) >= 0 && stageIndex(r.up_to_stage_key) <= limit)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/** 振り返りモードで使う軌跡: 振り返り版、無ければ当時版の最後(純粋関数)。 */
export function pickRetrospectiveTrajectory(rows: TrajectoryRow[]): TrajectoryRow | null {
  const newest = (kind: string) => rows.filter((r) => r.kind === kind).sort((a, b) => b.version - a.version)[0] ?? null;
  return newest("retrospective") ?? newest("live");
}

export async function buildSeniorMemory(
  admin: AdminClient,
  input: {
    projectId: string;
    mode: SeniorMode;
    juniorStageKey: string | null;
    queryEmbedding: number[] | null;
    /**
     * 当時モードの時間の軸。stage(既定)= 探究の段階(探究学習モード)/ lesson = 授業回の番号(教科・科目学習モード)。
     * lesson のときは、後輩のいまの回(juniorLessonNo)までの場面だけを読む。軌跡と段階の物語は、段階ごとに作られていて
     * 「この回まで」に絞れない(後の回のことを含みうる)ので、当時モードでは使わない。
     */
    timeAxis?: "stage" | "lesson";
    juniorLessonNo?: number | null;
    /**
     * 他の学校の先輩のAI(広い範囲の公開)。読むのは、他校向けに特定されにくくした場面(narrated_cross_org)だけ。
     * 軌跡と段階の物語は、他校向けの版が無い(学校名・地名などが残りうる)ので、使わない。
     */
    wide?: boolean;
  },
): Promise<SeniorMemory> {
  const retrievals: RetrievalRecord[] = [];
  const wide = input.wide === true;
  const byLesson = input.mode === "then" && input.timeAxis === "lesson" && typeof input.juniorLessonNo === "number";
  const { data: trajectoryRows } = await admin
    .from("inquiry_trajectories")
    .select("id, body, version, kind, up_to_stage_key")
    .eq("project_id", input.projectId);
  const trajectory = byLesson || wide
    ? null
    : input.mode === "then"
      ? pickThenTrajectory((trajectoryRows ?? []) as TrajectoryRow[], input.juniorStageKey)
      : pickRetrospectiveTrajectory((trajectoryRows ?? []) as TrajectoryRow[]);
  if (trajectory) retrievals.push({ kind: "trajectory", trajectory_id: trajectory.id });

  // いちばん近い場面(エピソード)1件。当時モードは、後輩のいまの段階までに絞る。
  let episodeBlock = "";
  if (input.queryEmbedding) {
    const { data: matches } = await admin.rpc("match_inquiry_episodes", {
      p_project_id: input.projectId,
      p_stage_keys: input.mode === "then" && !byLesson ? stagesUpTo(input.juniorStageKey) : null,
      p_kind: wide ? "narrated_cross_org" : "narrated",
      p_query_embedding: input.queryEmbedding,
      p_match_count: 1,
      ...(byLesson ? { p_max_lesson_no: input.juniorLessonNo } : {}),
    });
    const match = ((matches ?? []) as {
      episode_id: string;
      version_id: string;
      stage_key: string;
      context_header: string | null;
      body: string;
      similarity: number;
      lesson_no?: number | null;
    }[])[0];
    if (match) {
      retrievals.push({ kind: "episode", episode_version_id: match.version_id, rank: 1, similarity: match.similarity });
      // 親: その段階の物語(当時モードは当時版、振り返りモードは振り返り版、無ければ当時版)。
      const { data: stories } = await admin
        .from("inquiry_stage_stories")
        .select("id, body, kind, version")
        .eq("project_id", input.projectId)
        .eq("stage_key", match.stage_key)
        .order("version", { ascending: false });
      const pick = (kind: string) => (stories ?? []).find((s) => s.kind === kind) ?? null;
      const story = byLesson || wide ? null : input.mode === "retrospective" ? (pick("retrospective") ?? pick("live")) : pick("live");
      if (story) retrievals.push({ kind: "stage_story", stage_story_id: story.id as string });
      const when = byLesson && match.lesson_no ? `第${match.lesson_no}回の頃` : stageLabel(match.stage_key);
      episodeBlock = `## いまの話題に近い、あなたの場面(${when})
${match.context_header ? `${match.context_header}\n` : ""}${match.body}
${story ? `\n## その段階の、あなたの物語\n${story.body}\n` : ""}`;
    }
  }

  const text = `# あなたの探究の記録
${input.mode === "retrospective" ? RETRO_RULE : byLesson ? THEN_RULE_LESSON.replace("{N}", String(input.juniorLessonNo)) : THEN_RULE}
## これまでの流れ
${trajectory?.body ?? (wide ? "(全体の流れは、他の学校には見せない記録のため、話さない。下の場面に書かれていることだけを話す。覚えていないことは、覚えていないと答える。)" : byLesson ? "(この回までの全体の流れは、まとめていない。下の場面に書かれていることだけを話す。覚えていないことは、覚えていないと答える。)" : "(この段階までの記録は、まだ少ない。覚えていないことは、覚えていないと答える。)")}
${episodeBlock ? `\n${episodeBlock}` : ""}
${SENIOR_GUARDRAILS}`;
  return { text, retrievals };
}

export interface UsedRecord {
  mode: SeniorMode | null;
  trajectory: boolean;
  episode: { stageKey: string; header: string | null; body: string; similarity: number | null } | null;
}

/** 発言の監査用: 先輩のAIの発言ごとに、使った記録(どの段階のどの場面を読んだか)。 */
export async function loadUsedRecords(admin: AdminClient, turnIds: string[]): Promise<Map<string, UsedRecord>> {
  const result = new Map<string, UsedRecord>();
  if (turnIds.length === 0) return result;
  const { data: rows } = await admin
    .from("dialogue_turn_retrievals")
    .select("turn_id, kind, mode, episode_version_id, similarity")
    .in("turn_id", turnIds);
  const versionIds = (rows ?? []).map((r) => r.episode_version_id as string | null).filter((id): id is string => !!id);
  const { data: versions } =
    versionIds.length > 0
      ? await admin.from("inquiry_episode_versions").select("id, episode_id, context_header, body").in("id", versionIds)
      : { data: [] as { id: string; episode_id: string; context_header: string | null; body: string }[] };
  const episodeIds = (versions ?? []).map((v) => v.episode_id as string);
  const { data: episodes } =
    episodeIds.length > 0
      ? await admin.from("inquiry_episodes").select("id, stage_key").in("id", episodeIds)
      : { data: [] as { id: string; stage_key: string }[] };
  const stageOf = new Map((episodes ?? []).map((e) => [e.id as string, e.stage_key as string]));
  const versionById = new Map((versions ?? []).map((v) => [v.id as string, v]));
  for (const r of rows ?? []) {
    const entry = result.get(r.turn_id as string) ?? { mode: (r.mode as SeniorMode | null) ?? null, trajectory: false, episode: null };
    if (r.kind === "trajectory") entry.trajectory = true;
    if (r.kind === "episode" && r.episode_version_id) {
      const v = versionById.get(r.episode_version_id as string);
      if (v) {
        entry.episode = {
          stageKey: stageOf.get(v.episode_id as string) ?? "",
          header: (v.context_header as string | null) ?? null,
          body: v.body as string,
          similarity: (r.similarity as number | null) ?? null,
        };
      }
    }
    result.set(r.turn_id as string, entry);
  }
  return result;
}
