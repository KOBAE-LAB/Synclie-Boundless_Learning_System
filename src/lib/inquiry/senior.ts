// 先輩型ペルソナ(要件定義書14章ステップ6、実装(2b-1)、0045)。
//  - 教師が、自分の教科・科目の探究プロジェクト(軌跡ができているもの)から、AIに下書きを作らせる(1回の呼び出し)。
//  - 下書きを確認・修正して承認すると、同じ学校(組織)の先生が、自分の授業回に「貸し出し」て使える(参照だけ)。
//  - 先輩型は授業回に属さない(course_id は null)。材料のプロジェクトが消えたら、ペルソナも消える(0045の外部キー)。
// 誰がどのペルソナに触れるかの決まりを、ここにまとめる(テストあり)。
import type { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { withAiContext } from "@/lib/ai/usage";
import { draftSeniorPersona } from "@/lib/ai/senior-persona-draft";
import { isEligibleLearner } from "./pipeline";
import { stageLabel } from "./stages";

type AdminClient = ReturnType<typeof createAdminClient>;

export class SeniorRuleError extends Error {}

export const MAX_NICKNAME = 12;
/** 1つの授業回に貸し出せる先輩型の数(先輩型は発言ごとに記録を読むので、入力が増える。費用の上限)。 */
export const MAX_LOANS_PER_LESSON = 3;
export type SeniorMode = "then" | "retrospective";
export const SENIOR_MODE_LABELS: Record<SeniorMode, string> = {
  then: "当時モード(後輩と同じ段階にいたときの先輩)",
  retrospective: "振り返りモード(探究を終えた先輩)",
};

/** 「2025年度の先輩 ミナト(AI)」(要件定義書14章ステップ6の決定)。 */
export function seniorDisplayName(fiscalYear: number | null | undefined, nickname: string): string {
  return `${fiscalYear ? `${fiscalYear}年度の` : ""}先輩 ${nickname}(AI)`;
}

export function normalizeNickname(input: string): string {
  return input.replace(/[\s()()]/g, "").slice(0, MAX_NICKNAME);
}

export function isSeniorTier(tier: string | null | undefined): boolean {
  return tier === "senior" || tier === "other_school";
}

async function teacherOrg(admin: AdminClient, teacherId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("organization_id").eq("id", teacherId).maybeSingle();
  return (data?.organization_id as string | null) ?? null;
}

interface ArchivedPersona {
  id: string;
  tier: string;
  status: string;
  course_id: string | null;
  created_by: string | null;
  organization_id: string | null;
}

/** この先生が、このアーカイブのペルソナを見て使えるか: 作った本人か、同じ組織(学校)の先生。 */
export function canUseArchived(persona: Pick<ArchivedPersona, "created_by" | "organization_id">, teacherId: string, teacherOrgId: string | null): boolean {
  if (persona.created_by === teacherId) return true;
  return Boolean(persona.organization_id && teacherOrgId && persona.organization_id === teacherOrgId);
}

async function loadArchived(admin: AdminClient, personaId: string): Promise<ArchivedPersona> {
  const { data } = await admin
    .from("personas")
    .select("id, tier, status, course_id, created_by, organization_id")
    .eq("id", personaId)
    .maybeSingle();
  if (!data || !isSeniorTier(data.tier as string) || data.course_id) throw new SeniorRuleError("先輩のペルソナが見つかりません。");
  return data as ArchivedPersona;
}

/** 作った本人だけが直せる・消せる(同じ学校の先生は、使うだけ)。 */
async function assertCreator(admin: AdminClient, personaId: string, teacherId: string): Promise<ArchivedPersona> {
  const persona = await loadArchived(admin, personaId);
  if (persona.created_by !== teacherId) throw new SeniorRuleError("先輩のペルソナを直せるのは、作った先生だけです。");
  return persona;
}

async function latestTrajectory(admin: AdminClient, projectId: string, kind: "live" | "retrospective") {
  const { data } = await admin
    .from("inquiry_trajectories")
    .select("id, body, version, up_to_stage_key")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("version", { ascending: false })
    .limit(1);
  return (data?.[0] as { id: string; body: string; version: number; up_to_stage_key: string | null } | undefined) ?? null;
}

export interface SourceProject {
  id: string;
  title: string;
  theme: string | null;
  kind: string;
  seriesLabel: string | null;
  fiscalYear: number | null;
  hasRetrospective: boolean;
  seniorCount: number;
}

/** 先輩型の材料にできる探究プロジェクト: この先生の教科・科目のもので、軌跡ができているもの。 */
export async function listSourceProjects(admin: AdminClient, teacherId: string): Promise<SourceProject[]> {
  const { data: projects } = await admin
    .from("inquiry_projects")
    .select("id, title, theme, kind, series_label, fiscal_year, created_at")
    .eq("owner_teacher_id", teacherId)
    .order("created_at", { ascending: false });
  const ids = (projects ?? []).map((p) => p.id as string);
  if (ids.length === 0) return [];
  const [{ data: trajectories }, { data: seniors }] = await Promise.all([
    admin.from("inquiry_trajectories").select("project_id, kind").in("project_id", ids),
    admin.from("personas").select("source_project_id").in("source_project_id", ids),
  ]);
  const kinds = new Map<string, Set<string>>();
  for (const t of trajectories ?? []) {
    const set = kinds.get(t.project_id as string) ?? new Set<string>();
    set.add(t.kind as string);
    kinds.set(t.project_id as string, set);
  }
  const seniorCount = new Map<string, number>();
  for (const s of seniors ?? []) seniorCount.set(s.source_project_id as string, (seniorCount.get(s.source_project_id as string) ?? 0) + 1);
  return (projects ?? [])
    .filter((p) => kinds.has(p.id as string))
    .map((p) => ({
      id: p.id as string,
      title: p.title as string,
      theme: (p.theme as string | null) ?? null,
      kind: p.kind as string,
      seriesLabel: (p.series_label as string | null) ?? null,
      fiscalYear: (p.fiscal_year as number | null) ?? null,
      hasRetrospective: kinds.get(p.id as string)?.has("retrospective") ?? false,
      seniorCount: seniorCount.get(p.id as string) ?? 0,
    }));
}

/** 探究プロジェクトから、先輩型の下書きを作る(AIは1回)。教師が承認するまで使わない。 */
export async function createSeniorDraft(
  admin: AdminClient,
  input: { teacherId: string; projectId: string; nickname: string },
): Promise<{ personaId: string }> {
  const nickname = normalizeNickname(input.nickname);
  if (!nickname) throw new SeniorRuleError("呼び名を入力してください(例: ミナト)。");
  const { data: project } = await admin
    .from("inquiry_projects")
    .select("id, title, theme, kind, solo_student_id, owner_teacher_id, fiscal_year")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!project || project.owner_teacher_id !== input.teacherId) throw new SeniorRuleError("探究プロジェクトが見つかりません。");
  // 個人のプロジェクトは、本人がデータの利用に同意していること(グループは、抽出のときにメンバーごとに確かめている)。
  if (project.solo_student_id && !(await isEligibleLearner(admin, project.solo_student_id as string))) {
    throw new SeniorRuleError("この学習者はデータの利用に同意していないため、先輩のペルソナにできません。");
  }
  const trajectory = (await latestTrajectory(admin, project.id as string, "retrospective")) ?? (await latestTrajectory(admin, project.id as string, "live"));
  if (!trajectory) throw new SeniorRuleError("まだ探究の記録(軌跡)ができていません。段階が進むか、教科・科目を終えると作られます。");
  const { data: stories } = await admin.from("inquiry_stage_stories").select("stage_key").eq("project_id", project.id).eq("kind", "live");
  const stageNames = [...new Set((stories ?? []).map((s) => s.stage_key as string))].map(stageLabel);

  const draft = await withAiContext({ purpose: "senior_persona_draft", projectId: project.id as string }, () =>
    draftSeniorPersona({ theme: (project.theme as string | null) || (project.title as string), trajectory: trajectory.body, stageNames }),
  );
  const organizationId = await teacherOrg(admin, input.teacherId);
  const { data, error } = await admin
    .from("personas")
    .insert({
      course_id: null,
      tier: "senior",
      status: "draft",
      name: seniorDisplayName(project.fiscal_year as number | null, nickname),
      nickname,
      source_fiscal_year: project.fiscal_year ?? null,
      source_project_id: project.id,
      created_by: input.teacherId,
      organization_id: organizationId,
      profile: { role: draft.role, tone: draft.tone },
      stance: { position: draft.position, goal: draft.goal },
      behavior_rules: {
        speakingFrequency: "普通",
        teachingDegree: "問い返すのみ",
        interventionCondition: "後輩が迷っているとき、自分の経験が考える材料になりそうなとき",
      },
      origin_note: `探究プロジェクト「${project.title}」の記録から作った先輩のAI(下書き)。`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`先輩のペルソナを保存できませんでした: ${error?.message}`);
  return { personaId: data.id as string };
}

export interface ArchiveEntry {
  id: string;
  name: string;
  nickname: string | null;
  status: string;
  role: string;
  tone: string;
  position: string;
  goal: string;
  mine: boolean;
  sourceTitle: string | null;
  originNote: string | null;
}

/** この先生が見られる先輩型(自分で作ったもの+同じ学校の先生が作って承認したもの)。 */
export async function listArchive(admin: AdminClient, teacherId: string): Promise<ArchiveEntry[]> {
  const orgId = await teacherOrg(admin, teacherId);
  const { data } = await admin
    .from("personas")
    .select("id, name, nickname, status, profile, stance, created_by, organization_id, source_project_id, origin_note, tier, course_id, created_at")
    .is("course_id", null)
    .in("tier", ["senior", "other_school"])
    .order("created_at", { ascending: false });
  const visible = (data ?? []).filter(
    (p) => canUseArchived(p as ArchivedPersona, teacherId, orgId) && (p.created_by === teacherId || p.status === "approved"),
  );
  const projectIds = [...new Set(visible.map((p) => p.source_project_id as string).filter(Boolean))];
  const { data: projects } =
    projectIds.length > 0 ? await admin.from("inquiry_projects").select("id, title").in("id", projectIds) : { data: [] };
  const titleOf = new Map((projects ?? []).map((p) => [p.id as string, p.title as string]));
  return visible.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    nickname: (p.nickname as string | null) ?? null,
    status: p.status as string,
    role: (p.profile as { role?: string } | null)?.role ?? "",
    tone: (p.profile as { tone?: string } | null)?.tone ?? "",
    position: (p.stance as { position?: string } | null)?.position ?? "",
    goal: (p.stance as { goal?: string } | null)?.goal ?? "",
    mine: p.created_by === teacherId,
    // 同じ学校の先生には、材料のプロジェクト名(学習者の探究の名前)は見せない。作った先生だけが見る。
    sourceTitle: p.created_by === teacherId ? (titleOf.get(p.source_project_id as string) ?? null) : null,
    originNote: (p.origin_note as string | null) ?? null,
  }));
}

export async function updateSeniorPersona(
  admin: AdminClient,
  input: { teacherId: string; personaId: string; nickname: string; role: string; tone: string; position: string; goal: string },
) {
  await assertCreator(admin, input.personaId, input.teacherId);
  const nickname = normalizeNickname(input.nickname);
  if (!nickname) throw new SeniorRuleError("呼び名を入力してください。");
  const { data: current } = await admin.from("personas").select("source_fiscal_year").eq("id", input.personaId).maybeSingle();
  const { error } = await admin
    .from("personas")
    .update({
      nickname,
      name: seniorDisplayName(current?.source_fiscal_year as number | null, nickname),
      profile: { role: input.role.trim().slice(0, 80), tone: input.tone.trim().slice(0, 80) },
      stance: { position: input.position.trim().slice(0, 300), goal: input.goal.trim().slice(0, 300) },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.personaId);
  if (error) throw new Error(`保存できませんでした: ${error.message}`);
}

/** 承認する(下書き→承認済み)/下書きに戻す。下書きに戻すと、貸し出し中の授業回でも話さなくなる。 */
export async function setSeniorStatus(admin: AdminClient, input: { teacherId: string; personaId: string; status: "draft" | "approved" }) {
  await assertCreator(admin, input.personaId, input.teacherId);
  const { error } = await admin.from("personas").update({ status: input.status }).eq("id", input.personaId);
  if (error) throw new Error(`状態を変えられませんでした: ${error.message}`);
}

/** 先輩型を消す(貸し出しも消える。これまでの発言の記録は、名前の控えを持ったまま残る)。 */
export async function deleteSeniorPersona(admin: AdminClient, input: { teacherId: string; personaId: string }) {
  await assertCreator(admin, input.personaId, input.teacherId);
  const { data: persona } = await admin.from("personas").select("name").eq("id", input.personaId).maybeSingle();
  if (persona) {
    await admin.from("dialogue_turns").update({ persona_name: persona.name }).eq("persona_id", input.personaId).is("persona_name", null);
  }
  const { error } = await admin.from("personas").delete().eq("id", input.personaId);
  if (error) throw new Error(`削除できませんでした: ${error.message}`);
}

// ---------------------------------------------------------------------------
// 貸し出し(授業回で使う)
// ---------------------------------------------------------------------------

export async function addLoan(
  admin: AdminClient,
  input: { teacherId: string; courseId: string; personaId: string; mode: SeniorMode },
) {
  await assertOwnsCourse(admin, input.courseId, input.teacherId);
  const persona = await loadArchived(admin, input.personaId);
  if (!canUseArchived(persona, input.teacherId, await teacherOrg(admin, input.teacherId))) {
    throw new SeniorRuleError("この先輩のペルソナは、同じ学校の先生だけが使えます。");
  }
  if (persona.status !== "approved") throw new SeniorRuleError("承認済みの先輩のペルソナだけを使えます。");
  const { count } = await admin.from("persona_loans").select("id", { count: "exact", head: true }).eq("course_id", input.courseId);
  if ((count ?? 0) >= MAX_LOANS_PER_LESSON) {
    throw new SeniorRuleError(`先輩のペルソナは、1つの授業回に${MAX_LOANS_PER_LESSON}人までです。`);
  }
  const { error } = await admin.from("persona_loans").insert({
    persona_id: input.personaId,
    course_id: input.courseId,
    mode: input.mode,
    scope: "same_school",
    status: "active",
    created_by: input.teacherId,
    approved_by: input.teacherId,
    approved_at: new Date().toISOString(),
  });
  if (error?.code === "23505") throw new SeniorRuleError("この先輩のペルソナは、もうこの授業回にいます。");
  if (error) throw new Error(`加えられませんでした: ${error.message}`);
}

async function loadOwnLoan(admin: AdminClient, loanId: string, courseId: string, teacherId: string) {
  await assertOwnsCourse(admin, courseId, teacherId);
  const { data } = await admin.from("persona_loans").select("id, course_id").eq("id", loanId).maybeSingle();
  if (!data || data.course_id !== courseId) throw new SeniorRuleError("貸し出しが見つかりません。");
}

export async function updateLoan(
  admin: AdminClient,
  input: { teacherId: string; courseId: string; loanId: string; mode?: SeniorMode; status?: "active" | "paused" },
) {
  await loadOwnLoan(admin, input.loanId, input.courseId, input.teacherId);
  const patch: Record<string, string> = {};
  if (input.mode) patch.mode = input.mode;
  if (input.status) patch.status = input.status;
  if (Object.keys(patch).length === 0) return;
  const { error } = await admin.from("persona_loans").update(patch).eq("id", input.loanId);
  if (error) throw new Error(`変えられませんでした: ${error.message}`);
}

export async function removeLoan(admin: AdminClient, input: { teacherId: string; courseId: string; loanId: string }) {
  await loadOwnLoan(admin, input.loanId, input.courseId, input.teacherId);
  const { error } = await admin.from("persona_loans").delete().eq("id", input.loanId);
  if (error) throw new Error(`外せませんでした: ${error.message}`);
}

export interface LessonLoan {
  loanId: string;
  personaId: string;
  name: string;
  mode: SeniorMode;
  status: string;
  personaStatus: string;
}

export async function listLessonLoans(admin: AdminClient, courseId: string): Promise<LessonLoan[]> {
  const { data: loans } = await admin
    .from("persona_loans")
    .select("id, persona_id, mode, status, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  const ids = (loans ?? []).map((l) => l.persona_id as string);
  if (ids.length === 0) return [];
  const { data: personas } = await admin.from("personas").select("id, name, status").in("id", ids);
  const byId = new Map((personas ?? []).map((p) => [p.id as string, p]));
  return (loans ?? [])
    .filter((l) => byId.has(l.persona_id as string))
    .map((l) => ({
      loanId: l.id as string,
      personaId: l.persona_id as string,
      name: byId.get(l.persona_id as string)!.name as string,
      mode: l.mode as SeniorMode,
      status: l.status as string,
      personaStatus: byId.get(l.persona_id as string)!.status as string,
    }));
}
