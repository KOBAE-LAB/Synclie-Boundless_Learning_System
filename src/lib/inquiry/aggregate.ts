// 集約型ペルソナ(0047、要件定義書14章の実装(2c))。前の年度の教科・科目の、複数の学習者の記録(②)から、共通するつまずき・
// よくある誤解・有効だった問いをまとめ、「前の年度の学習者の記録をもとにしたAI」を作る。
//  - 材料は、②(軌跡と、匿名化・語り化された場面)だけ。個人の発言(①)は使わない。AIには、記録の要約だけを渡す(氏名は元から無い)。
//  - データの利用に同意している学習者が MIN_AGGREGATE_LEARNERS 人以上いるときだけ作る(個人が特定されにくくするため)。
//    作ったあとも、同意を撤回した学習者を除いて MIN 人を下回ったら、その集約型は話さない(aggregateStillSpeaks)。
//  - 先輩型と同じく、先生(作った本人)が確認・修正して承認し、同じ学校の授業回に貸し出す。授業回に属さない(course_id は null)。
import type { createAdminClient } from "@/lib/supabase/server";
import { withAiContext } from "@/lib/ai/usage";
import { draftAggregatePersona } from "@/lib/ai/aggregate-persona";
import { isEligibleLearner } from "./pipeline";
import { assertCreator, isAggregateTier, MAX_NICKNAME, normalizeNickname, pauseCrossOrgLoans, SCOPE_RESET, SeniorRuleError } from "./senior";
import { aggregateDisplayName, linesToItems, MIN_AGGREGATE_LEARNERS, parseAggregateItems } from "./aggregate-items";

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_MATERIAL_CHARS = 9000;
const MAX_TRAJECTORY_CHARS = 700;
const MAX_EPISODE_CHARS = 220;
const MAX_EPISODES_PER_PROJECT = 4;

export interface SeriesMaterial {
  projects: {
    id: string;
    trajectory: string | null;
    episodes: { lessonNo: number | null; header: string | null; body: string }[];
    studentIds: string[];
  }[];
}

/** 教科・科目の、②の材料(軌跡か場面があるプロジェクトだけ)と、そのプロジェクトの学習者。 */
export async function loadSeriesMaterial(admin: AdminClient, seriesId: string): Promise<SeriesMaterial> {
  const { data: projects } = await admin.from("inquiry_projects").select("id, kind, solo_student_id").eq("series_id", seriesId);
  const ids = (projects ?? []).map((p) => p.id as string);
  if (ids.length === 0) return { projects: [] };
  const [{ data: trajectories }, { data: episodes }, { data: members }] = await Promise.all([
    admin.from("inquiry_trajectories").select("project_id, kind, version, body").in("project_id", ids),
    admin.from("inquiry_episodes").select("id, project_id, lesson_no, seq").in("project_id", ids).order("seq", { ascending: true }),
    admin.from("inquiry_project_members").select("project_id, student_id").in("project_id", ids),
  ]);
  const episodeIds = (episodes ?? []).map((e) => e.id as string);
  const { data: versions } =
    episodeIds.length > 0
      ? await admin
          .from("inquiry_episode_versions")
          .select("episode_id, context_header, body, version")
          .in("episode_id", episodeIds)
          .eq("kind", "narrated")
          .order("version", { ascending: false })
      : { data: [] as { episode_id: string; context_header: string | null; body: string; version: number }[] };
  const versionOf = new Map<string, { context_header: string | null; body: string }>();
  for (const v of versions ?? []) if (!versionOf.has(v.episode_id as string)) versionOf.set(v.episode_id as string, v as { context_header: string | null; body: string });

  return {
    projects: (projects ?? [])
      .map((p) => {
        const traj = (trajectories ?? [])
          .filter((t) => t.project_id === p.id)
          .sort((a, b) => (a.kind === b.kind ? (b.version as number) - (a.version as number) : a.kind === "retrospective" ? -1 : 1))[0];
        const eps = (episodes ?? [])
          .filter((e) => e.project_id === p.id && versionOf.has(e.id as string))
          .slice(0, MAX_EPISODES_PER_PROJECT)
          .map((e) => ({ lessonNo: (e.lesson_no as number | null) ?? null, header: versionOf.get(e.id as string)!.context_header, body: versionOf.get(e.id as string)!.body }));
        const studentIds = new Set<string>((members ?? []).filter((m) => m.project_id === p.id).map((m) => m.student_id as string));
        if (p.solo_student_id) studentIds.add(p.solo_student_id as string);
        return { id: p.id as string, trajectory: (traj?.body as string | undefined) ?? null, episodes: eps, studentIds: [...studentIds] };
      })
      .filter((p) => p.trajectory || p.episodes.length > 0),
  };
}

/** 同意している(テスト学習者でない)学習者の集合。 */
async function eligibleSet(admin: AdminClient, studentIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const id of [...new Set(studentIds)]) if (await isEligibleLearner(admin, id)) set.add(id);
  return set;
}

/** 材料のうち、同意している学習者が1人でもいるプロジェクトだけを残し、同意している学習者の人数を数える。 */
export async function eligibleMaterial(admin: AdminClient, material: SeriesMaterial) {
  const eligible = await eligibleSet(admin, material.projects.flatMap((p) => p.studentIds));
  const projects = material.projects.filter((p) => p.studentIds.some((id) => eligible.has(id)));
  const learners = new Set(projects.flatMap((p) => p.studentIds.filter((id) => eligible.has(id))));
  return { projects, learnerCount: learners.size };
}

export interface AggregateSource {
  seriesId: string;
  title: string;
  fiscalYear: number | null;
  archived: boolean;
  learnerCount: number;
  aggregateCount: number;
}

/** 集約型の材料にできる教科・科目: この先生の教科・科目で、②の記録があるもの。人数が足りるかは learnerCount で分かる。 */
export async function listAggregateSources(admin: AdminClient, teacherId: string): Promise<AggregateSource[]> {
  const { data: series } = await admin
    .from("course_series")
    .select("id, title, fiscal_year, archived_at")
    .eq("owner_teacher_id", teacherId)
    .order("fiscal_year", { ascending: false });
  const result: AggregateSource[] = [];
  for (const s of series ?? []) {
    const material = await loadSeriesMaterial(admin, s.id as string);
    if (material.projects.length === 0) continue;
    const { learnerCount } = await eligibleMaterial(admin, material);
    const { count } = await admin.from("personas").select("id", { count: "exact", head: true }).eq("source_series_id", s.id).eq("tier", "aggregate");
    result.push({
      seriesId: s.id as string,
      title: s.title as string,
      fiscalYear: (s.fiscal_year as number | null) ?? null,
      archived: Boolean(s.archived_at),
      learnerCount,
      aggregateCount: count ?? 0,
    });
  }
  return result;
}

/** AIに渡す材料の文(個人の発言は含まない。軌跡と、語り化された場面だけ)。長さに上限がある。 */
export function buildMaterialsText(projects: SeriesMaterial["projects"]): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  let text = "";
  projects.forEach((p, i) => {
    let block = `■ 記録${i + 1}\n`;
    if (p.trajectory) block += `流れ: ${clip(p.trajectory, MAX_TRAJECTORY_CHARS)}\n`;
    for (const e of p.episodes) {
      block += `場面${e.lessonNo ? `(第${e.lessonNo}回)` : ""}: ${e.header ? `${e.header} / ` : ""}${clip(e.body, MAX_EPISODE_CHARS)}\n`;
    }
    if (text.length + block.length <= MAX_MATERIAL_CHARS) text += `${block}\n`;
  });
  return text.trim();
}

/** 教科・科目の記録から、集約型の下書きを作る(AIは1回)。教師が承認するまで使わない。 */
export async function createAggregateDraft(
  admin: AdminClient,
  input: { teacherId: string; seriesId: string; nickname?: string },
): Promise<{ personaId: string }> {
  const nickname = normalizeNickname(input.nickname ?? "");
  const { data: series } = await admin
    .from("course_series")
    .select("id, title, fiscal_year, owner_teacher_id")
    .eq("id", input.seriesId)
    .maybeSingle();
  if (!series || series.owner_teacher_id !== input.teacherId) throw new SeniorRuleError("教科・科目が見つかりません。");

  const material = await loadSeriesMaterial(admin, input.seriesId);
  const { projects, learnerCount } = await eligibleMaterial(admin, material);
  if (learnerCount < MIN_AGGREGATE_LEARNERS) {
    throw new SeniorRuleError(
      `集約型は、データの利用に同意している学習者の記録が${MIN_AGGREGATE_LEARNERS}人分以上ないと作れません(いまは${learnerCount}人分)。個人が特定されにくくするためです。`,
    );
  }

  const draft = await withAiContext({ purpose: "aggregate_persona_draft" }, () =>
    draftAggregatePersona({ subject: series.title as string, materials: buildMaterialsText(projects) }),
  );
  const { data: teacher } = await admin.from("profiles").select("organization_id").eq("id", input.teacherId).maybeSingle();
  const { data, error } = await admin
    .from("personas")
    .insert({
      course_id: null,
      tier: "aggregate",
      status: "draft",
      name: aggregateDisplayName(series.fiscal_year as number | null, nickname),
      nickname: nickname || null,
      source_fiscal_year: series.fiscal_year ?? null,
      source_series_id: series.id,
      created_by: input.teacherId,
      organization_id: (teacher?.organization_id as string | null) ?? null,
      profile: { role: draft.role, tone: draft.tone },
      stance: { position: draft.position, goal: draft.goal, items: draft.items },
      behavior_rules: {
        speakingFrequency: "普通",
        teachingDegree: "問い返すのみ",
        interventionCondition: "後輩が、前の年度の多くの人がつまずいた点に近づいているとき",
      },
      origin_note: `教科・科目「${series.title}」の、${learnerCount}人分の記録から作った集約型のAI(下書き)。`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`集約型のペルソナを保存できませんでした: ${error?.message}`);
  const personaId = data.id as string;
  const { error: srcError } = await admin
    .from("persona_source_projects")
    .insert(projects.map((p) => ({ persona_id: personaId, project_id: p.id })));
  if (srcError) {
    await admin.from("personas").delete().eq("id", personaId);
    throw new Error(`材料の記録を保存できませんでした: ${srcError.message}`);
  }
  return { personaId };
}

/** 集約型の内容を直す(作った先生だけ)。まとめた項目は、1行に1項目の文字から読み直す。 */
export async function updateAggregatePersona(
  admin: AdminClient,
  input: { teacherId: string; personaId: string; nickname: string; role: string; tone: string; position: string; goal: string; itemsText: string },
) {
  const persona = await assertCreator(admin, input.personaId, input.teacherId);
  if (!isAggregateTier(persona.tier)) throw new SeniorRuleError("集約型のAIではありません。");
  const nickname = normalizeNickname(input.nickname).slice(0, MAX_NICKNAME);
  const { data: current } = await admin.from("personas").select("source_fiscal_year").eq("id", input.personaId).maybeSingle();
  const { error } = await admin
    .from("personas")
    .update({
      nickname: nickname || null,
      name: aggregateDisplayName(current?.source_fiscal_year as number | null, nickname),
      profile: { role: input.role.trim().slice(0, 80), tone: input.tone.trim().slice(0, 80) },
      stance: { position: input.position.trim().slice(0, 300), goal: input.goal.trim().slice(0, 300), items: linesToItems(input.itemsText) },
      updated_at: new Date().toISOString(),
      // 内容を直したら、広い範囲の公開は取り消して、承認をやり直す
      ...SCOPE_RESET,
    })
    .eq("id", input.personaId);
  if (error) throw new Error(`保存できませんでした: ${error.message}`);
  await pauseCrossOrgLoans(admin, input.personaId);
}

/**
 * 集約型がいま話してよいか: 材料の学習者のうち、いまもデータの利用に同意している人が MIN 人以上いること
 * (同意の撤回や、全データの削除で材料が減って、人数が足りなくなったら話さない)。
 */
export async function aggregateStillSpeaks(admin: AdminClient, personaId: string): Promise<boolean> {
  const { data: sources } = await admin.from("persona_source_projects").select("project_id").eq("persona_id", personaId);
  const projectIds = (sources ?? []).map((s) => s.project_id as string);
  if (projectIds.length === 0) return false;
  const [{ data: members }, { data: projects }] = await Promise.all([
    admin.from("inquiry_project_members").select("student_id").in("project_id", projectIds),
    admin.from("inquiry_projects").select("solo_student_id").in("id", projectIds),
  ]);
  const ids = new Set<string>([
    ...(members ?? []).map((m) => m.student_id as string),
    ...(projects ?? []).map((p) => p.solo_student_id as string | null).filter((id): id is string => !!id),
  ]);
  return (await eligibleSet(admin, [...ids])).size >= MIN_AGGREGATE_LEARNERS;
}

/**
 * 学習者本人の全データ削除(F16)の前に呼ぶ: この学習者の記録(個人のプロジェクト・グループ)が材料に入っている、承認済みの集約型を
 * 下書きに戻す(まとめた項目に、本人の記録から来た内容が残っているかもしれないため。先生に確かめて、必要なら作り直してもらう)。
 */
export async function invalidateAggregatesForStudent(admin: AdminClient, studentId: string): Promise<number> {
  const [{ data: solo }, { data: memberships }] = await Promise.all([
    admin.from("inquiry_projects").select("id").eq("solo_student_id", studentId),
    admin.from("inquiry_project_members").select("project_id").eq("student_id", studentId),
  ]);
  const projectIds = [...new Set([...(solo ?? []).map((p) => p.id as string), ...(memberships ?? []).map((m) => m.project_id as string)])];
  if (projectIds.length === 0) return 0;
  const { data: sources } = await admin.from("persona_source_projects").select("persona_id").in("project_id", projectIds);
  const personaIds = [...new Set((sources ?? []).map((s) => s.persona_id as string))];
  if (personaIds.length === 0) return 0;
  const { data: changed, error } = await admin
    .from("personas")
    .update({ status: "draft", ...SCOPE_RESET, origin_note: "材料にした学習者の記録が削除されたため、下書きに戻しました。内容を確かめて、必要なら作り直してから承認してください。" })
    .in("id", personaIds)
    .eq("tier", "aggregate")
    .eq("status", "approved")
    .select("id");
  if (error) throw new Error(`集約型のAIを下書きに戻せませんでした: ${error.message}`);
  return changed?.length ?? 0;
}
