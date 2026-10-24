// 他の学校で使う先輩のAIの材料にすることへの、学習者の別の同意(consent_records.scope = 'share_wide'、0049)。
// 広い範囲(同じ自治体・連携グループ)の公開は、材料の学習者が全員、この同意をしているときだけ使える。
//   - 先輩型: 材料のプロジェクトの学習者のうち、データ利用に同意している人が、全員同意していること(グループなら、メンバー全員)
//   - 集約型: 同意している学習者が MIN_AGGREGATE_LEARNERS 人以上いて、その全員が、この同意をしていること
// 同意を撤回したら、その学習者の記録から作った先輩のAIは、広い範囲から外れる(invalidateWideScopeForStudent)。
import type { createAdminClient } from "@/lib/supabase/server";
import { isEligibleLearner } from "./eligibility";
import { MIN_AGGREGATE_LEARNERS } from "./aggregate-items";

type AdminClient = ReturnType<typeof createAdminClient>;

export const WIDE_CONSENT_SCOPE = "share_wide";

export async function hasWideConsent(admin: AdminClient, studentId: string): Promise<boolean> {
  const { data } = await admin
    .from("consent_records")
    .select("granted_at, withdrawn_at")
    .eq("student_id", studentId)
    .eq("scope", WIDE_CONSENT_SCOPE)
    .maybeSingle();
  return Boolean(data && data.granted_at && !data.withdrawn_at);
}

/** プロジェクトに関わる学習者(個人プロジェクトの本人+グループのメンバー)。 */
export async function projectLearnerIds(admin: AdminClient, projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const [{ data: members }, { data: projects }] = await Promise.all([
    admin.from("inquiry_project_members").select("student_id").in("project_id", projectIds),
    admin.from("inquiry_projects").select("solo_student_id").in("id", projectIds),
  ]);
  return [
    ...new Set([
      ...(members ?? []).map((m) => m.student_id as string),
      ...(projects ?? []).map((p) => p.solo_student_id as string | null).filter((id): id is string => !!id),
    ]),
  ];
}

export interface WideSourcePersona {
  id: string;
  tier: string;
  source_project_id?: string | null;
}

/** 材料の学習者の同意が、広い範囲で使うのに足りているか。 */
export async function wideConsentOk(admin: AdminClient, persona: WideSourcePersona): Promise<boolean> {
  let projectIds: string[] = [];
  if (persona.tier === "aggregate") {
    const { data } = await admin.from("persona_source_projects").select("project_id").eq("persona_id", persona.id);
    projectIds = (data ?? []).map((s) => s.project_id as string);
  } else if (persona.source_project_id) {
    projectIds = [persona.source_project_id];
  }
  const learners = await projectLearnerIds(admin, projectIds);
  const eligible: string[] = [];
  for (const id of learners) if (await isEligibleLearner(admin, id)) eligible.push(id);
  const needed = persona.tier === "aggregate" ? MIN_AGGREGATE_LEARNERS : 1;
  if (eligible.length < needed) return false;
  for (const id of eligible) if (!(await hasWideConsent(admin, id))) return false;
  return true;
}

/**
 * 学習者が、他の学校で使うことへの同意を撤回した(または、データの利用への同意を撤回した)とき:
 * その学習者の記録が材料に入っている先輩のAIを、広い範囲から外す(同じ学校の範囲に戻す)。
 * 他の学校に貸し出していた分は、使用を止める(行は残す)。戻した数を返す。
 */
export async function invalidateWideScopeForStudent(admin: AdminClient, studentId: string): Promise<number> {
  const [{ data: solo }, { data: memberships }] = await Promise.all([
    admin.from("inquiry_projects").select("id").eq("solo_student_id", studentId),
    admin.from("inquiry_project_members").select("project_id").eq("student_id", studentId),
  ]);
  const projectIds = [...new Set([...(solo ?? []).map((p) => p.id as string), ...(memberships ?? []).map((m) => m.project_id as string)])];
  if (projectIds.length === 0) return 0;
  const [{ data: direct }, { data: viaAggregate }] = await Promise.all([
    admin.from("personas").select("id").in("source_project_id", projectIds),
    admin.from("persona_source_projects").select("persona_id").in("project_id", projectIds),
  ]);
  const personaIds = [...new Set([...(direct ?? []).map((p) => p.id as string), ...(viaAggregate ?? []).map((p) => p.persona_id as string)])];
  if (personaIds.length === 0) return 0;
  const { data: changed, error } = await admin
    .from("personas")
    .update({ share_scope: "school", share_network_id: null, scope_request: null, scope_request_network_id: null, scope_requested_at: null })
    .in("id", personaIds)
    .in("share_scope", ["municipality", "network"])
    .select("id");
  if (error) throw new Error(`公開範囲を戻せませんでした: ${error.message}`);
  // 申請中だけで、まだ広がっていないものも取り下げる
  await admin
    .from("personas")
    .update({ scope_request: null, scope_request_network_id: null, scope_requested_at: null })
    .in("id", personaIds)
    .not("scope_request", "is", null);
  await admin.from("persona_loans").update({ status: "paused" }).in("persona_id", personaIds).eq("scope", "cross_org");
  return changed?.length ?? 0;
}
