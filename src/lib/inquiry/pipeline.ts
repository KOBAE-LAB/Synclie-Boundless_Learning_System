// ②抽出層を作る処理(要件定義書14章ステップ5)。queue.ts の runPendingJobs から、仕事の種類ごとに呼ばれる。
//  - extract_session: 1つの議論から、印の付いた場面をエピソードにする(AIは1回)
//  - build_stage_story: 終わった段階のエピソードから、段階の物語(当時版)と軌跡の新しい版を作る(AIは1回)
//  - build_retrospective: 探究の終了後に、振り返り版の段階の物語と軌跡を作る(AIは1回)
// どれも、データ利用に同意している学習者の記録だけを使う(管理者のテスト学習者は除く)。①は書き換えない。
import type { createAdminClient } from "@/lib/supabase/server";
import { openai, MODEL_EMBEDDING, MODEL_JUDGE } from "@/lib/ai/openai";
import { withAiContext } from "@/lib/ai/usage";
import { extractEpisodes, EPISODE_TYPES } from "@/lib/ai/episode-extraction";
import { buildLiveStageStory, buildRetrospective } from "@/lib/ai/stage-story";
import { isEligibleLearner } from "./eligibility";
import { runAnonymizeEpisodes } from "./anonymize-job";
import { applyTurnCorrections } from "@/lib/records/corrections";
import { memberAlias } from "@/lib/learn/session-scope";
import { maskNames } from "./anonymize";
import { MARKER_REASONS, type MarkerKind } from "./markers";
import { CANONICAL_STAGES, FIRST_STAGE, isStageKey, stageLabel } from "./stages";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface JobRow {
  id: string;
  kind: "extract_session" | "build_stage_story" | "build_retrospective" | "anonymize_episodes";
  project_id: string;
  session_id: string | null;
  stage_key: string | null;
  prompt_version: string;
  status: string;
  attempts: number;
}

export type JobOutcome = "done" | "skipped";

export async function runJob(admin: AdminClient, job: JobRow): Promise<JobOutcome> {
  switch (job.kind) {
    case "extract_session":
      return extractSession(admin, job);
    case "build_stage_story":
      return buildStageStory(admin, job);
    case "build_retrospective":
      return buildRetrospectiveForProject(admin, job);
    case "anonymize_episodes":
      return runAnonymizeEpisodes(admin, job);
  }
}

export { isEligibleLearner };

interface ProjectRow {
  id: string;
  title: string;
  theme: string | null;
  current_stage_key: string | null;
  created_at: string;
  owner_teacher_id: string | null;
  kind: string;
  solo_student_id: string | null;
}

async function loadProject(admin: AdminClient, projectId: string): Promise<ProjectRow> {
  const { data } = await admin
    .from("inquiry_projects")
    .select("id, title, theme, current_stage_key, created_at, owner_teacher_id, kind, solo_student_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) throw new Error("探究プロジェクトが見つかりません。");
  return data as ProjectRow;
}

async function nextVersion(admin: AdminClient, table: string, filters: Record<string, string>): Promise<number> {
  let query = admin.from(table).select("version");
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data } = await query.order("version", { ascending: false }).limit(1);
  return ((data?.[0]?.version as number | undefined) ?? 0) + 1;
}

async function latestTrajectory(admin: AdminClient, projectId: string, kind: "live" | "retrospective" = "live") {
  const { data } = await admin
    .from("inquiry_trajectories")
    .select("id, body, version, up_to_stage_key")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("version", { ascending: false })
    .limit(1);
  return (data?.[0] as { id: string; body: string; version: number; up_to_stage_key: string | null } | undefined) ?? null;
}

/** 伏せる名前: 学習者本人・担当教師の表示名と、学習者の組織名。 */
async function namesToMask(admin: AdminClient, studentIds: string[], teacherId: string | null): Promise<string[]> {
  const ids = [...studentIds, teacherId].filter((id): id is string => !!id);
  const { data: profiles } = await admin.from("profiles").select("display_name, organization_id").in("id", ids);
  const orgIds = [...new Set((profiles ?? []).map((p) => p.organization_id).filter((id): id is string => !!id))];
  const { data: orgs } = orgIds.length > 0 ? await admin.from("organizations").select("name").in("id", orgIds) : { data: [] };
  return [...(profiles ?? []).map((p) => p.display_name as string | null), ...(orgs ?? []).map((o) => o.name as string)].filter(
    (n): n is string => !!n,
  );
}

/** グループに入ったことのあるメンバー全員(抜けた人も)。仮の呼び名の順番(参加した順)を、議論の途中で変えないため。 */
async function loadGroupMemberIdsEverJoined(admin: AdminClient, projectId: string): Promise<string[]> {
  const { data } = await admin
    .from("inquiry_project_members")
    .select("student_id, joined_at")
    .eq("project_id", projectId)
    .order("joined_at", { ascending: true });
  return (data ?? []).map((m) => m.student_id as string);
}

async function embed(text: string): Promise<number[]> {
  const response = await withAiContext({ purpose: "episode_embedding" }, () =>
    openai.embeddings.create({ model: MODEL_EMBEDDING, input: text }),
  );
  return response.data[0].embedding;
}

// ---------------------------------------------------------------------------
// extract_session: 議論 → エピソード
// ---------------------------------------------------------------------------

interface TurnRow {
  id: string;
  speaker_type: "student" | "persona";
  content: string;
  persona_name: string | null;
  author_student_id: string | null;
}

async function extractSession(admin: AdminClient, job: JobRow): Promise<JobOutcome> {
  if (!job.session_id) return "skipped";
  const { data: session } = await admin
    .from("learning_sessions")
    .select("id, student_id, course_id, project_id, started_at")
    .eq("id", job.session_id)
    .maybeSingle();
  if (!session) return "skipped";
  // 個人の議論は本人、グループの議論(0044)はメンバーごとに、同意しているかを確かめる。
  const isGroup = !session.student_id;
  if (!isGroup && !(await isEligibleLearner(admin, session.student_id as string))) return "skipped";

  const [{ data: turnRows }, { data: markerRows }, { data: existingEpisodes }] = await Promise.all([
    admin
      .from("dialogue_turns")
      .select("id, speaker_type, content, persona_name, author_student_id")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true }),
    admin.from("inquiry_markers").select("turn_id, kind").eq("session_id", session.id),
    admin.from("inquiry_episodes").select("id").eq("session_id", session.id),
  ]);
  const allTurns = await applyTurnCorrections(admin, (turnRows ?? []) as TurnRow[]);
  // グループの議論: 同意していないメンバー(とテスト学習者)の発言は、AIにも記録の材料にも使わない。
  const memberIds = isGroup ? await loadGroupMemberIdsEverJoined(admin, session.project_id ?? job.project_id) : [];
  const eligibleAuthors = new Set<string>();
  if (isGroup) {
    const authors = [...new Set(allTurns.map((t) => t.author_student_id).filter((id): id is string => !!id))];
    for (const id of authors) if (await isEligibleLearner(admin, id)) eligibleAuthors.add(id);
  }
  const turns = isGroup
    ? allTurns.filter((t) => t.speaker_type !== "student" || (t.author_student_id && eligibleAuthors.has(t.author_student_id)))
    : allTurns;
  if (!turns.some((t) => t.speaker_type === "student")) return "skipped";
  const indexOf = new Map(turns.map((t, i) => [t.id, i + 1]));

  // すでにエピソードにした範囲(出典の発言から復元する)
  const covered: { startTurn: number; endTurn: number }[] = [];
  const episodeIds = (existingEpisodes ?? []).map((e) => e.id as string);
  if (episodeIds.length > 0) {
    const { data: sources } = await admin
      .from("inquiry_sources")
      .select("derived_id, source_id")
      .eq("derived_kind", "episode")
      .eq("source_kind", "dialogue_turn")
      .in("derived_id", episodeIds);
    const spans = new Map<string, number[]>();
    for (const s of sources ?? []) {
      const i = indexOf.get(s.source_id as string);
      if (i) spans.set(s.derived_id as string, [...(spans.get(s.derived_id as string) ?? []), i]);
    }
    for (const indexes of spans.values()) covered.push({ startTurn: Math.min(...indexes), endTurn: Math.max(...indexes) });
  }

  // 印の付いた発言のうち、まだエピソードになっていないもの。1つも無ければAIを呼ばない(費用を抑える)。
  const marked = (markerRows ?? [])
    .map((m) => ({ turn: indexOf.get(m.turn_id as string), kind: m.kind as MarkerKind }))
    .filter((m): m is { turn: number; kind: MarkerKind } => !!m.turn)
    .filter((m) => !covered.some((c) => c.startTurn <= m.turn && m.turn <= c.endTurn));
  if (marked.length === 0) return "skipped";

  const project = await loadProject(admin, session.project_id ?? job.project_id);
  // 作り直し(学習者の全データ削除の後など)では、元のエピソードと同じ段階に置く(job.stage_key)。
  const stageKey = (isStageKey(job.stage_key) ? job.stage_key : null) ?? project.current_stage_key ?? FIRST_STAGE;
  const [trajectory, reflectionText, names, lessonNo] = await Promise.all([
    latestTrajectory(admin, project.id),
    loadReflectionText(admin, session.id, isGroup ? [...eligibleAuthors] : null),
    namesToMask(admin, isGroup ? memberIds : [session.student_id as string], project.owner_teacher_id),
    session.course_id
      ? admin.from("courses").select("lesson_no").eq("id", session.course_id).maybeSingle().then((r) => (r.data?.lesson_no as number | undefined) ?? null)
      : Promise.resolve(null),
  ]);

  // グループでは「メンバーA」などの仮の呼び名(参加した順。氏名はAIに送らない)。
  const speaker = (t: TurnRow) =>
    t.speaker_type === "student"
      ? isGroup
        ? `学習者(${memberAlias(memberIds, t.author_student_id)})`
        : "学習者"
      : `AIの${t.persona_name ?? "仲間"}`;
  const transcript = turns.map((t, i) => `[T${i + 1}] ${speaker(t)}: ${t.content}`).join("\n");

  const extracted = await withAiContext(
    { purpose: "episode_extraction", courseId: session.course_id, projectId: project.id },
    () =>
      extractEpisodes(
        {
          theme: project.theme || project.title,
          stageLabel: stageLabel(stageKey),
          transcript,
          markedTurns: marked.map((m) => ({ turn: m.turn, reason: MARKER_REASONS[m.kind] })),
          reflectionText,
          trajectorySoFar: trajectory?.body ?? "",
          alreadyCovered: covered,
        },
        turns.length,
      ),
  );
  if (extracted.length === 0) return "done";

  const { data: lastEpisode } = await admin
    .from("inquiry_episodes")
    .select("id, seq")
    .eq("project_id", project.id)
    .order("seq", { ascending: false })
    .limit(1);
  let prevId = (lastEpisode?.[0]?.id as string | undefined) ?? null;
  let seq = (lastEpisode?.[0]?.seq as number | undefined) ?? 0;
  const relativeDay = Math.max(
    0,
    Math.floor((new Date(session.started_at).getTime() - new Date(project.created_at).getTime()) / 86_400_000),
  );

  for (const e of extracted) {
    const spanTurns = turns.slice(e.startTurn - 1, e.endTurn);
    const kindsInSpan = new Set(marked.filter((m) => m.turn >= e.startTurn && m.turn <= e.endTurn).map((m) => m.kind));
    const pickedBy = kindsInSpan.has("student_keep") ? "student" : kindsInSpan.has("teacher_mark") ? "teacher" : "auto";
    const header = maskNames(e.contextHeader, names);
    const narrative = maskNames(e.narrative, names);

    seq += 1;
    const { data: episode, error } = await admin
      .from("inquiry_episodes")
      .insert({
        project_id: project.id,
        session_id: session.id,
        stage_key: stageKey,
        episode_type: e.type,
        seq,
        prev_episode_id: prevId,
        relative_day: relativeDay,
        lesson_no: lessonNo,
        picked_by: pickedBy,
        prompt_version: job.prompt_version,
      })
      .select("id")
      .single();
    if (error || !episode) throw new Error(`エピソードの保存に失敗しました: ${error?.message}`);

    const embedding = await embed(`${header}\n${narrative}`);
    const { error: versionError } = await admin.from("inquiry_episode_versions").insert([
      {
        episode_id: episode.id,
        kind: "excerpt",
        version: 1,
        body: spanTurns.map((t) => `${speaker(t)}: ${t.content}`).join("\n"),
        prompt_version: job.prompt_version,
      },
      {
        episode_id: episode.id,
        kind: "narrated",
        version: 1,
        body: narrative,
        context_header: header,
        embedding,
        model: MODEL_JUDGE,
        prompt_version: job.prompt_version,
      },
    ]);
    if (versionError) throw new Error(`エピソードの版の保存に失敗しました: ${versionError.message}`);

    await admin.from("inquiry_sources").insert(
      spanTurns.map((t) => ({ derived_kind: "episode", derived_id: episode.id, source_kind: "dialogue_turn", source_id: t.id, role: "span" })),
    );
    prevId = episode.id as string;
  }
  return "done";
}

/** 議論の振り返り。グループでは、同意しているメンバーの成果の振り返りだけ(onlyStudents)。 */
async function loadReflectionText(admin: AdminClient, sessionId: string, onlyStudents: string[] | null): Promise<string> {
  const { data: submissions } = await admin.from("submissions").select("id, student_id").eq("session_id", sessionId);
  const ids = (submissions ?? [])
    .filter((s) => !onlyStudents || onlyStudents.includes(s.student_id as string))
    .map((s) => s.id as string);
  if (ids.length === 0) return "";
  const { data: reflections } = await admin
    .from("reflections")
    .select("what_learned, what_confused")
    .in("submission_id", ids);
  return (reflections ?? [])
    .map((r) => `学んだこと: ${r.what_learned}\n迷ったこと: ${r.what_confused}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// build_stage_story: 段階のエピソード → 段階の物語(当時版)+軌跡の新しい版
// ---------------------------------------------------------------------------

async function buildStageStory(admin: AdminClient, job: JobRow): Promise<JobOutcome> {
  if (!job.stage_key) return "skipped";
  const project = await loadProject(admin, job.project_id);
  if (project.solo_student_id && !(await isEligibleLearner(admin, project.solo_student_id))) return "skipped";

  const { data: episodes } = await admin
    .from("inquiry_episodes")
    .select("id, seq")
    .eq("project_id", project.id)
    .eq("stage_key", job.stage_key)
    .order("seq", { ascending: true });
  const episodeIds = (episodes ?? []).map((e) => e.id as string);
  if (episodeIds.length === 0) return "skipped";

  const narratives = await latestNarratives(admin, episodeIds);
  const previous = await latestTrajectory(admin, project.id);
  const result = await withAiContext({ purpose: "stage_story", projectId: project.id }, () =>
    buildLiveStageStory({
      theme: project.theme || project.title,
      stageLabel: stageLabel(job.stage_key),
      episodes: episodeIds.map((id) => narratives.get(id)).filter((t): t is string => !!t),
      previousTrajectory: previous?.body ?? "",
    }),
  );

  const storyVersion = await nextVersion(admin, "inquiry_stage_stories", { project_id: project.id, stage_key: job.stage_key, kind: "live" });
  const { data: story, error } = await admin
    .from("inquiry_stage_stories")
    .insert({
      project_id: project.id,
      stage_key: job.stage_key,
      kind: "live",
      version: storyVersion,
      body: result.stageStory,
      model: MODEL_JUDGE,
      prompt_version: job.prompt_version,
    })
    .select("id")
    .single();
  if (error || !story) throw new Error(`段階の物語の保存に失敗しました: ${error?.message}`);

  // その段階のエピソードの親を、いちばん新しい段階の物語にする。
  await admin.from("inquiry_episodes").update({ parent_story_id: story.id }).in("id", episodeIds);
  await admin.from("inquiry_sources").insert(
    episodeIds.map((id) => ({ derived_kind: "stage_story", derived_id: story.id, source_kind: "episode", source_id: id, role: "episode" })),
  );

  const trajectoryVersion = await nextVersion(admin, "inquiry_trajectories", { project_id: project.id, kind: "live" });
  const { data: trajectory } = await admin
    .from("inquiry_trajectories")
    .insert({
      project_id: project.id,
      kind: "live",
      version: trajectoryVersion,
      up_to_stage_key: job.stage_key,
      body: result.trajectory,
      model: MODEL_JUDGE,
      prompt_version: job.prompt_version,
    })
    .select("id")
    .single();
  if (trajectory) {
    await admin.from("inquiry_sources").insert({
      derived_kind: "trajectory",
      derived_id: trajectory.id,
      source_kind: "stage_story",
      source_id: story.id,
      role: "stage_story",
    });
  }
  return "done";
}

async function latestNarratives(admin: AdminClient, episodeIds: string[]): Promise<Map<string, string>> {
  const { data } = await admin
    .from("inquiry_episode_versions")
    .select("episode_id, body, version")
    .eq("kind", "narrated")
    .in("episode_id", episodeIds)
    .order("version", { ascending: true });
  const latest = new Map<string, string>();
  for (const row of data ?? []) latest.set(row.episode_id as string, row.body as string); // 昇順なので最後が最新
  return latest;
}

// ---------------------------------------------------------------------------
// build_retrospective: 探究の終了後の振り返り版
// ---------------------------------------------------------------------------

async function buildRetrospectiveForProject(admin: AdminClient, job: JobRow): Promise<JobOutcome> {
  const project = await loadProject(admin, job.project_id);
  if (project.solo_student_id && !(await isEligibleLearner(admin, project.solo_student_id))) return "skipped";

  const { data: stories } = await admin
    .from("inquiry_stage_stories")
    .select("stage_key, body, version")
    .eq("project_id", project.id)
    .eq("kind", "live")
    .order("version", { ascending: true });
  const latestByStage = new Map<string, string>();
  for (const s of stories ?? []) latestByStage.set(s.stage_key as string, s.body as string);
  if (latestByStage.size === 0) return "skipped";

  const stages = CANONICAL_STAGES.filter((s) => latestByStage.has(s.key)).map((s) => ({
    stageKey: s.key,
    stageLabel: s.label,
    liveStory: latestByStage.get(s.key) as string,
  }));
  const last = await latestTrajectory(admin, project.id);
  const result = await withAiContext({ purpose: "stage_retrospective", projectId: project.id }, () =>
    buildRetrospective({ theme: project.theme || project.title, stages, lastTrajectory: last?.body ?? "" }),
  );

  for (const s of result.stageStories) {
    const version = await nextVersion(admin, "inquiry_stage_stories", { project_id: project.id, stage_key: s.stageKey, kind: "retrospective" });
    await admin.from("inquiry_stage_stories").insert({
      project_id: project.id,
      stage_key: s.stageKey,
      kind: "retrospective",
      version,
      body: s.story,
      model: MODEL_JUDGE,
      prompt_version: job.prompt_version,
    });
  }
  const version = await nextVersion(admin, "inquiry_trajectories", { project_id: project.id, kind: "retrospective" });
  await admin.from("inquiry_trajectories").insert({
    project_id: project.id,
    kind: "retrospective",
    version,
    up_to_stage_key: stages[stages.length - 1]?.stageKey ?? null,
    body: result.trajectory,
    model: MODEL_JUDGE,
    prompt_version: job.prompt_version,
  });
  return "done";
}

/** 画面の表示用: エピソードの種類の日本語名。 */
export function episodeTypeLabel(type: string): string {
  return (EPISODE_TYPES as Record<string, string>)[type] ?? type;
}
