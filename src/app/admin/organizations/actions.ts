"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeName, validateOrgUpdate } from "@/lib/organizations/admin";

// 管理者だけが、組織の種類(学校・自治体)・親の自治体・所属の確認と、連携グループを管理する。
// 先輩のAIを同じ学校の外へ出す範囲(同じ自治体・連携グループ)の土台。所属が確かな(verified)組織だけが、広い範囲に出せる。

export async function updateOrganizationAction(orgId: string, formData: FormData) {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: municipalities } = await admin.from("organizations").select("id").eq("kind", "municipality");
  const result = validateOrgUpdate({
    orgId,
    kind: String(formData.get("kind") ?? ""),
    parentId: String(formData.get("parentId") ?? ""),
    verified: formData.get("verified") === "on",
    municipalityIds: (municipalities ?? []).map((m) => m.id as string),
  });
  if (!result.ok) throw new Error(result.error);
  const { error } = await admin.from("organizations").update(result.update).eq("id", orgId);
  if (error) throw new Error(`保存できませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}

export async function createMunicipalityAction(formData: FormData) {
  await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) throw new Error("自治体の名前を2文字以上で入力してください。");
  const admin = createAdminClient();
  const { data: same } = await admin.from("organizations").select("id").eq("name", name).maybeSingle();
  if (same) throw new Error("同じ名前の組織が、すでにあります。");
  // 管理者が作った自治体は、所属が確かな組織として扱う
  const { error } = await admin.from("organizations").insert({ name, kind: "municipality", verified: true });
  if (error) throw new Error(`作成できませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}

export async function createNetworkAction(formData: FormData) {
  const { user } = await requireAdmin();
  const name = normalizeName(String(formData.get("name") ?? ""));
  if (!name) throw new Error("連携グループの名前を2文字以上で入力してください。");
  const admin = createAdminClient();
  const { error } = await admin.from("organization_networks").insert({ name, created_by: user.id });
  if (error) throw new Error(`作成できませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}

export async function addNetworkMemberAction(networkId: string, formData: FormData) {
  await requireAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  if (!orgId) throw new Error("追加する組織を選んでください。");
  const admin = createAdminClient();
  const { error } = await admin.from("organization_network_members").insert({ network_id: networkId, organization_id: orgId });
  if (error && error.code !== "23505") throw new Error(`追加できませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}

export async function removeNetworkMemberAction(networkId: string, orgId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("organization_network_members").delete().eq("network_id", networkId).eq("organization_id", orgId);
  if (error) throw new Error(`外せませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}

export async function deleteNetworkAction(networkId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  // 先輩のAIの公開範囲が、このグループを指していたら、同じ学校の範囲に戻す(外部キーは null になるため、範囲も戻す)
  await admin
    .from("personas")
    .update({ share_scope: "school", share_network_id: null })
    .eq("share_network_id", networkId);
  const { error } = await admin.from("organization_networks").delete().eq("id", networkId);
  if (error) throw new Error(`削除できませんでした: ${error.message}`);
  revalidatePath("/admin/organizations");
}
