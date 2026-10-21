// 授業回で話す擬似メンバー: その授業回の「使用中」のペルソナ+貸し出し中の先輩型(0045)。
// 対話(dialogue.ts)・自動継続・学習画面は、ここを通して擬似メンバーを読むこと
// (personas を course_id で直接引くと、先輩型が抜ける)。
import type { createAdminClient } from "@/lib/supabase/server";
import { isEligibleLearner } from "@/lib/inquiry/pipeline";
import type { SeniorMode } from "@/lib/inquiry/senior";
import { buildSeniorMemory, type SeniorMemory } from "@/lib/inquiry/senior-memory";
import { embedQuery, searchMaterialChunks, searchMaterialChunksByEmbedding } from "@/lib/rag/search";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface LessonMember {
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
  tier?: string;
  /** 先輩型の材料のプロジェクトと、この授業回での使い方(貸し出し) */
  sourceProjectId?: string | null;
  loan?: { id: string; mode: SeniorMode } | null;
}

const COLUMNS = "id, name, profile, stance, behavior_rules, tier, source_project_id, status";

/**
 * いま話す擬似メンバー。授業回のペルソナ(作成順)のあとに、先輩型(貸し出した順)。
 * 先輩型は、承認済みで、貸し出しが「使用中」のものだけ。個人の探究から作った先輩型は、その学習者が
 * いまもデータの利用に同意している場合だけ話す(撤回したら、その記録は使わない)。
 */
export async function loadActiveMembers(admin: AdminClient, courseId: string): Promise<LessonMember[]> {
  const [{ data: own }, { data: loans }] = await Promise.all([
    admin.from("personas").select(COLUMNS).eq("course_id", courseId).eq("status", "active").order("created_at", { ascending: true }),
    admin.from("persona_loans").select("id, persona_id, mode, created_at").eq("course_id", courseId).eq("status", "active").order("created_at", { ascending: true }),
  ]);
  const members: LessonMember[] = (own ?? []).map((p) => ({ ...(p as LessonMember), sourceProjectId: null, loan: null }));
  const loanIds = (loans ?? []).map((l) => l.persona_id as string);
  if (loanIds.length === 0) return members;

  const { data: seniors } = await admin.from("personas").select(COLUMNS).in("id", loanIds);
  const byId = new Map((seniors ?? []).map((p) => [p.id as string, p]));
  const projectIds = [...new Set((seniors ?? []).map((p) => p.source_project_id as string).filter(Boolean))];
  const { data: projects } =
    projectIds.length > 0
      ? await admin.from("inquiry_projects").select("id, solo_student_id").in("id", projectIds)
      : { data: [] as { id: string; solo_student_id: string | null }[] };
  const soloStudentOf = new Map((projects ?? []).map((p) => [p.id as string, p.solo_student_id as string | null]));

  for (const loan of loans ?? []) {
    const p = byId.get(loan.persona_id as string);
    if (!p || p.status !== "approved" || !p.source_project_id) continue;
    const soloStudent = soloStudentOf.get(p.source_project_id as string);
    if (soloStudent && !(await isEligibleLearner(admin, soloStudent))) continue;
    members.push({
      ...(p as LessonMember),
      sourceProjectId: p.source_project_id as string,
      loan: { id: loan.id as string, mode: loan.mode as SeniorMode },
    });
  }
  return members;
}

/** 先輩型がいるときの教材の検索件数(先輩の記録が入る分、教材を5件から3件に減らす。要件定義書14章ステップ6の費用)。 */
export const MATERIAL_COUNT_WITH_SENIORS = 3;

/**
 * 1回の発言のための検索: 教材と、先輩型それぞれの記憶。発言の埋め込みは1回だけ作り、両方で共用する。
 * queryText が無ければ(沈黙時の自動継続で、学習者の発言がまだ無いなど)、教材は検索せず、先輩の記憶は軌跡だけにする。
 */
export async function retrieveForTurn(
  admin: AdminClient,
  input: { courseId: string; members: LessonMember[]; queryText: string | null; juniorProjectId: string | null },
): Promise<{ materialChunks: string[]; memories: Map<string, { memory: SeniorMemory; mode: SeniorMode }> }> {
  const seniors = input.members.filter((m) => m.loan && m.sourceProjectId);
  const memories = new Map<string, { memory: SeniorMemory; mode: SeniorMode }>();
  if (seniors.length === 0) {
    return { materialChunks: input.queryText ? await searchMaterialChunks(input.courseId, input.queryText) : [], memories };
  }
  const embedding = input.queryText ? await embedQuery(input.queryText) : null;
  const juniorStage = input.juniorProjectId
    ? (((await admin.from("inquiry_projects").select("current_stage_key").eq("id", input.juniorProjectId).maybeSingle()).data
        ?.current_stage_key as string | null) ?? null)
    : null;
  const [materialChunks] = await Promise.all([
    embedding ? searchMaterialChunksByEmbedding(input.courseId, embedding, MATERIAL_COUNT_WITH_SENIORS) : Promise.resolve([]),
    ...seniors.map(async (s) => {
      const memory = await buildSeniorMemory(admin, {
        projectId: s.sourceProjectId as string,
        mode: s.loan!.mode,
        juniorStageKey: juniorStage,
        queryEmbedding: embedding,
      });
      memories.set(s.id, { memory, mode: s.loan!.mode });
    }),
  ]);
  return { materialChunks: materialChunks as string[], memories };
}

/** 先輩型の発言に、使った記録を残す(失敗しても対話は止めない)。 */
export async function recordRetrievals(
  admin: AdminClient,
  input: { turnId: string; personaId: string; memory: SeniorMemory; mode: SeniorMode },
) {
  if (input.memory.retrievals.length === 0) return;
  const { error } = await admin.from("dialogue_turn_retrievals").insert(
    input.memory.retrievals.map((r) => ({ ...r, turn_id: input.turnId, persona_id: input.personaId, mode: input.mode })),
  );
  if (error) console.error("[senior] 検索の記録を残せませんでした", error);
}

/** 授業回に貸し出したことのある先輩型(使用中でなくても)。学習画面で、過去の発言の名前・アバターを引くのに使う。 */
export async function loadLoanedPersonaRows(admin: AdminClient, courseId: string) {
  const { data: loans } = await admin.from("persona_loans").select("persona_id").eq("course_id", courseId).order("created_at", { ascending: true });
  const ids = (loans ?? []).map((l) => l.persona_id as string);
  if (ids.length === 0) return [];
  const { data } = await admin.from("personas").select("id, name, avatar_id, status, created_at, behavior_rules, tier").in("id", ids);
  const byId = new Map((data ?? []).map((p) => [p.id as string, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
}
