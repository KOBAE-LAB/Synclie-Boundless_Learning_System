// 先輩のAIの公開範囲を変える・広げる申請を承認する(0049)。
//  - 狭める(自分だけ/同じ学校)は、作った先生がすぐ変えられる。広い範囲に出していたものは、他校への貸し出しを止める。
//  - 広げる(同じ自治体/連携グループ)は、申請 → 持ち主の組織の承認者が承認して、はじめて有効になる。
//    申請と承認のどちらでも、(1)所属の確かな組織 (2)材料の学習者全員の別の同意 を確かめる。承認されたら、他校向けの版づくりを積む。
import type { createAdminClient } from "@/lib/supabase/server";
import { loadOrgInfos } from "@/lib/organizations/context";
import { isShareScope, isWideScope, needsApproval, validateScopeChange, type ShareScope } from "@/lib/organizations/scope";
import { SeniorRuleError, assertCreator } from "./senior";
import { wideConsentOk } from "./wide-consent";
import { enqueueJob } from "./queue";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function requestScopeChange(
  admin: AdminClient,
  input: { teacherId: string; personaId: string; requested: string; networkId?: string | null },
): Promise<{ applied: boolean }> {
  if (!isShareScope(input.requested)) throw new SeniorRuleError("公開範囲が正しくありません。");
  const requested: ShareScope = input.requested;
  const persona = await assertCreator(admin, input.personaId, input.teacherId);
  const infos = await loadOrgInfos(admin, [persona.organization_id]);
  const ownerOrg = persona.organization_id ? (infos.get(persona.organization_id) ?? null) : null;
  const networkId = requested === "network" ? (input.networkId ?? null) : null;
  const problem = validateScopeChange({ requested, networkId, ownerOrg });
  if (problem) throw new SeniorRuleError(problem);

  if (!needsApproval(requested)) {
    const wasWide = isWideScope(persona.share_scope);
    const { error } = await admin
      .from("personas")
      .update({ share_scope: requested, share_network_id: null, scope_request: null, scope_request_network_id: null, scope_requested_at: null })
      .eq("id", persona.id);
    if (error) throw new Error(`公開範囲を変えられませんでした: ${error.message}`);
    // 狭めたら、他の学校への貸し出しは使わない(行は残す)
    if (wasWide) await admin.from("persona_loans").update({ status: "paused" }).eq("persona_id", persona.id).eq("scope", "cross_org");
    return { applied: true };
  }

  if (persona.status !== "approved") throw new SeniorRuleError("承認済みの先輩のペルソナだけを、広い範囲に公開できます。");
  if (!(await wideConsentOk(admin, persona as { id: string; tier: string; source_project_id?: string | null }))) {
    throw new SeniorRuleError("材料の学習者の全員が、他の学校で使うことに同意している必要があります(同意が足りません)。");
  }
  const { error } = await admin
    .from("personas")
    .update({ scope_request: requested, scope_request_network_id: networkId, scope_requested_at: new Date().toISOString() })
    .eq("id", persona.id);
  if (error) throw new Error(`申請を保存できませんでした: ${error.message}`);
  return { applied: false };
}

export interface PendingScopeRequest {
  personaId: string;
  name: string;
  requested: ShareScope;
  networkName: string | null;
  requesterName: string | null;
  requestedAt: string | null;
}

/** この先生が承認者になっている組織の、先輩のAIの、広げる申請(承認待ち)。 */
export async function listPendingScopeRequests(admin: AdminClient, approverId: string): Promise<PendingScopeRequest[]> {
  const { data: orgs } = await admin.from("organizations").select("id").eq("approver_teacher_id", approverId);
  const orgIds = (orgs ?? []).map((o) => o.id as string);
  if (orgIds.length === 0) return [];
  const { data: personas } = await admin
    .from("personas")
    .select("id, name, scope_request, scope_request_network_id, scope_requested_at, created_by")
    .in("organization_id", orgIds)
    .not("scope_request", "is", null)
    .order("scope_requested_at", { ascending: true });
  const rows = personas ?? [];
  if (rows.length === 0) return [];
  const networkIds = [...new Set(rows.map((p) => p.scope_request_network_id as string | null).filter((id): id is string => !!id))];
  const requesterIds = [...new Set(rows.map((p) => p.created_by as string | null).filter((id): id is string => !!id))];
  const [{ data: networks }, { data: profiles }] = await Promise.all([
    networkIds.length > 0 ? admin.from("organization_networks").select("id, name").in("id", networkIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    requesterIds.length > 0 ? admin.from("profiles").select("id, display_name").in("id", requesterIds) : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const networkName = new Map((networks ?? []).map((n) => [n.id as string, n.name as string]));
  const profileName = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]));
  return rows
    .filter((p) => isShareScope(p.scope_request))
    .map((p) => ({
      personaId: p.id as string,
      name: p.name as string,
      requested: p.scope_request as ShareScope,
      networkName: p.scope_request_network_id ? (networkName.get(p.scope_request_network_id as string) ?? null) : null,
      requesterName: p.created_by ? (profileName.get(p.created_by as string) ?? null) : null,
      requestedAt: (p.scope_requested_at as string | null) ?? null,
    }));
}

/** 持ち主の組織の承認者が、広げる申請を、承認または見送りする。承認の時点で、条件をもう一度確かめる。 */
export async function decideScopeRequest(
  admin: AdminClient,
  input: { approverId: string; personaId: string; decision: "approved" | "declined" },
): Promise<void> {
  const { data: persona } = await admin
    .from("personas")
    .select("id, tier, status, organization_id, source_project_id, scope_request, scope_request_network_id")
    .eq("id", input.personaId)
    .maybeSingle();
  if (!persona || !isShareScope(persona.scope_request) || !persona.organization_id) throw new SeniorRuleError("承認待ちの申請が見つかりません。");
  const { data: org } = await admin.from("organizations").select("approver_teacher_id").eq("id", persona.organization_id).maybeSingle();
  if (!org || org.approver_teacher_id !== input.approverId) throw new SeniorRuleError("この申請を判断できるのは、組織の承認者だけです。");

  const clear = { scope_request: null, scope_request_network_id: null, scope_requested_at: null };
  if (input.decision === "declined") {
    const { error } = await admin.from("personas").update(clear).eq("id", persona.id);
    if (error) throw new Error(`見送りを保存できませんでした: ${error.message}`);
    return;
  }

  const requested = persona.scope_request as ShareScope;
  const networkId = (persona.scope_request_network_id as string | null) ?? null;
  const infos = await loadOrgInfos(admin, [persona.organization_id as string]);
  const problem = validateScopeChange({ requested, networkId, ownerOrg: infos.get(persona.organization_id as string) ?? null });
  if (problem) throw new SeniorRuleError(problem);
  if (persona.status !== "approved") throw new SeniorRuleError("この先輩のペルソナは、承認済みではなくなっています。");
  if (!(await wideConsentOk(admin, persona as { id: string; tier: string; source_project_id?: string | null }))) {
    throw new SeniorRuleError("材料の学習者の同意が足りなくなっています。承認できません。");
  }
  const { error } = await admin.from("personas").update({ share_scope: requested, share_network_id: networkId, ...clear }).eq("id", persona.id);
  if (error) throw new Error(`承認を保存できませんでした: ${error.message}`);
  // 先輩型は、エピソードの他校向けの版を作る(集約型は、まとめた項目だけを使うので要らない)
  if (persona.tier !== "aggregate" && persona.source_project_id) {
    await enqueueJob(admin, { kind: "anonymize_episodes", projectId: persona.source_project_id as string, round: `approve-${persona.id}` });
  }
}
