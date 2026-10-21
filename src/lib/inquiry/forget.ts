// 学習者本人の全データ削除(F16)のうち、探究のグループの議論の部分(0044)。
// グループの議論はメンバーで共有しているので、議論ごとは消さず、本人の発言だけを消す。
// 本人の発言から作った②抽出層(エピソード・段階の物語・軌跡)は、本人の言葉を含みうるため消し、
// 残ったメンバーの記録から作り直す仕事を積む(作り直しは、印の付いた発言があるときだけAIを呼ぶ)。
import type { createAdminClient } from "@/lib/supabase/server";
import { enqueueJob } from "./queue";
import { stageIndex } from "./stages";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface GroupForgetResult {
  /** 消した本人の発言の数 */
  turnsDeleted: number;
  /** 本人の発言に付いていた手書き画像・音声のファイル(呼び出し側で Storage から消す) */
  handwritingPaths: string[];
  audioPaths: string[];
  /** 作り直しを積んだグループ */
  rebuiltProjectIds: string[];
}

export async function forgetStudentInGroups(admin: AdminClient, studentId: string): Promise<GroupForgetResult> {
  const result: GroupForgetResult = { turnsDeleted: 0, handwritingPaths: [], audioPaths: [], rebuiltProjectIds: [] };

  // 本人の発言のうち、グループの議論(student_id が null)のもの。
  const { data: authored } = await admin
    .from("dialogue_turns")
    .select("id, session_id, source_kind, source_path")
    .eq("author_student_id", studentId);
  const sessionIdsOfTurns = [...new Set((authored ?? []).map((t) => t.session_id as string))];
  if (sessionIdsOfTurns.length === 0) return result;
  const { data: groupSessions } = await admin
    .from("learning_sessions")
    .select("id, project_id")
    .in("id", sessionIdsOfTurns)
    .is("student_id", null);
  const groupSessionIds = new Set((groupSessions ?? []).map((s) => s.id as string));
  if (groupSessionIds.size === 0) return result;
  const turns = (authored ?? []).filter((t) => groupSessionIds.has(t.session_id as string));
  const turnIds = turns.map((t) => t.id as string);
  for (const t of turns) {
    if (!t.source_path) continue;
    if (t.source_kind === "audio") result.audioPaths.push(t.source_path as string);
    else result.handwritingPaths.push(t.source_path as string);
  }
  const projectIds = [...new Set((groupSessions ?? []).map((s) => s.project_id as string).filter(Boolean))];

  // ②: 本人の発言があった議論のエピソードと、そのグループの段階の物語・軌跡を消す。
  const { data: episodes } = await admin.from("inquiry_episodes").select("id, session_id, stage_key").in("session_id", [...groupSessionIds]);
  const episodeIds = (episodes ?? []).map((e) => e.id as string);
  const [{ data: stories }, { data: trajectories }] = await Promise.all([
    projectIds.length > 0
      ? admin.from("inquiry_stage_stories").select("id, project_id, stage_key, kind").in("project_id", projectIds)
      : Promise.resolve({ data: [] as { id: string; project_id: string; stage_key: string; kind: string }[] }),
    projectIds.length > 0
      ? admin.from("inquiry_trajectories").select("id, kind").in("project_id", projectIds)
      : Promise.resolve({ data: [] as { id: string; kind: string }[] }),
  ]);
  const storyIds = (stories ?? []).map((s) => s.id as string);
  const trajectoryIds = (trajectories ?? []).map((t) => t.id as string);

  const check = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`${what}の削除に失敗しました: ${r.error.message}`);
  };
  // 出典(どの記録から作ったか)の行は、外部キーでつながっていないので、明示的に消す。
  const derivedIds = [...episodeIds, ...storyIds, ...trajectoryIds];
  if (derivedIds.length > 0) check(await admin.from("inquiry_sources").delete().in("derived_id", derivedIds), "出典");
  if (turnIds.length > 0) {
    check(await admin.from("inquiry_sources").delete().eq("source_kind", "dialogue_turn").in("source_id", turnIds), "出典");
  }
  if (episodeIds.length > 0) check(await admin.from("inquiry_episodes").delete().in("id", episodeIds), "エピソード");
  if (storyIds.length > 0) check(await admin.from("inquiry_stage_stories").delete().in("id", storyIds), "段階の物語");
  if (trajectoryIds.length > 0) check(await admin.from("inquiry_trajectories").delete().in("id", trajectoryIds), "軌跡");

  // ①: 本人の発言(印・論証評価・修正版は外部キーの連鎖で消える)。テーマの変更者の印も外す(テーマの文はグループのもの)。
  check(await admin.from("dialogue_turns").delete().in("id", turnIds), "対話ログ");
  check(await admin.from("inquiry_theme_changes").update({ changed_by: null }).eq("changed_by", studentId), "テーマの履歴");
  result.turnsDeleted = turnIds.length;

  // 作り直し: 議論ごとの抽出と、消した段階の物語・振り返り。積む鍵を毎回変えて、前の仕事と区別する。
  const round = `forget:${crypto.randomUUID()}`;
  // 作り直すエピソードは、消す前と同じ段階に置く(いまの段階で作り直すと、探究の流れが崩れるため)。
  const stageOfSession = new Map<string, string>();
  for (const e of episodes ?? []) if (!stageOfSession.has(e.session_id as string)) stageOfSession.set(e.session_id as string, e.stage_key as string);
  for (const s of groupSessions ?? []) {
    if (!s.project_id) continue;
    await enqueueJob(admin, {
      kind: "extract_session",
      projectId: s.project_id as string,
      sessionId: s.id as string,
      stageKey: stageOfSession.get(s.id as string) ?? null,
      round,
    });
  }
  // 段階の物語は段階の順に(軌跡は前の段階の版の上に作るため)、振り返り版は最後に。
  const ordered = [...(stories ?? [])].sort(
    (a, b) => (a.kind === "retrospective" ? 1 : 0) - (b.kind === "retrospective" ? 1 : 0) || stageIndex(a.stage_key) - stageIndex(b.stage_key),
  );
  for (const story of ordered) {
    const projectId = story.project_id as string;
    if (story.kind === "retrospective") {
      await enqueueJob(admin, { kind: "build_retrospective", projectId, round });
    } else {
      await enqueueJob(admin, { kind: "build_stage_story", projectId, stageKey: story.stage_key as string, round });
    }
  }
  result.rebuiltProjectIds = projectIds;
  return result;
}
