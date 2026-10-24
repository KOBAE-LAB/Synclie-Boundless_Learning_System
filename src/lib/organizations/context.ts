// 組織の情報(種類・親・所属の確かさ・連携グループ)を読む。公開範囲の判定(scope.ts)に渡す。
import type { createAdminClient } from "@/lib/supabase/server";
import type { OrgInfo, Viewer } from "./scope";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function loadOrgInfos(admin: AdminClient, ids: (string | null | undefined)[]): Promise<Map<string, OrgInfo>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  const result = new Map<string, OrgInfo>();
  if (unique.length === 0) return result;
  const [{ data: orgs }, { data: members }] = await Promise.all([
    admin.from("organizations").select("id, name, kind, parent_organization_id, verified").in("id", unique),
    admin.from("organization_network_members").select("organization_id, network_id").in("organization_id", unique),
  ]);
  for (const o of orgs ?? []) {
    result.set(o.id as string, {
      id: o.id as string,
      name: o.name as string,
      kind: (o.kind as string | null) ?? "school",
      parentId: (o.parent_organization_id as string | null) ?? null,
      verified: Boolean(o.verified),
      networkIds: (members ?? []).filter((m) => m.organization_id === o.id).map((m) => m.network_id as string),
    });
  }
  return result;
}

/** この先生が、どの組織の先生として見るか(組織に入っていなければ org は null)。 */
export async function loadViewer(admin: AdminClient, teacherId: string): Promise<Viewer> {
  const { data } = await admin.from("profiles").select("organization_id").eq("id", teacherId).maybeSingle();
  const orgId = (data?.organization_id as string | null) ?? null;
  const infos = await loadOrgInfos(admin, [orgId]);
  return { teacherId, org: orgId ? (infos.get(orgId) ?? null) : null };
}
