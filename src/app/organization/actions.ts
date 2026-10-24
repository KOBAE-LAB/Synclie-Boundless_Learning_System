"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { decideScopeRequest } from "@/lib/inquiry/share-scope";
import { scheduleJobRun } from "@/lib/inquiry/queue";
import { SeniorRuleError } from "@/lib/inquiry/senior";

// F21: 組織への参加・作成。SSO(F22)導入前の段階1〜2では、教師が組織名を入力して
// 自己申告で参加・作成する(既存に同名の組織があれば参加、無ければ新規作成して
// 自分を承認者にする)。SSO導入後は実際のテナントに置き換わる想定。
export async function joinOrCreateOrganizationAction(formData: FormData) {
  const { user } = await requireRole("teacher");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("組織名を入力してください。");
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("organizations")
    .select("id, approver_teacher_id")
    .eq("name", name)
    .maybeSingle();

  let organizationId: string;
  if (existing) {
    organizationId = existing.id;
    // 承認者が未設定の組織(例: 過去に参加者が抜けた等)に参加する場合、自分を承認者にする。
    if (!existing.approver_teacher_id) {
      await admin.from("organizations").update({ approver_teacher_id: user.id }).eq("id", organizationId);
    }
  } else {
    const { data: created, error } = await admin
      .from("organizations")
      .insert({ name, approver_teacher_id: user.id })
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(`組織の作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
    }
    organizationId = created.id;
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ organization_id: organizationId })
    .eq("id", user.id);
  if (updateError) {
    throw new Error(`組織への参加に失敗しました: ${updateError.message}`);
  }

  revalidatePath("/organization");
}

// F21: 組織の承認者(組織をまたぐ共有リクエストを判断する人)を変更する。
// 「承認者の指定方法」は要件定義書12章で未解決の論点。単一の管理者ロールがまだ無いため、
// ここでは組織に所属する教師なら誰でも変更できる、という最小限の自己統治ルールにしている。
export async function setApproverAction(formData: FormData) {
  const { user } = await requireRole("teacher");
  const newApproverId = String(formData.get("approverId") ?? "").trim();
  if (!newApproverId) {
    throw new Error("承認者を選択してください。");
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organization_id) {
    throw new Error("組織に参加していません。");
  }

  const { data: candidate } = await admin
    .from("profiles")
    .select("id")
    .eq("id", newApproverId)
    .eq("organization_id", profile.organization_id)
    .eq("role", "teacher")
    .maybeSingle();
  if (!candidate) {
    throw new Error("同じ組織に所属する教師のみ承認者に指定できます。");
  }

  const { error } = await admin
    .from("organizations")
    .update({ approver_teacher_id: newApproverId })
    .eq("id", profile.organization_id);
  if (error) {
    throw new Error(`承認者の変更に失敗しました: ${error.message}`);
  }

  revalidatePath("/organization");
}

// F21: 組織をまたぐ共有リクエストを、組織の承認者が判断する。
export async function decideShareRequestAction(
  requestId: string,
  decision: "approved" | "declined",
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const { data: request } = await admin
    .from("share_requests")
    .select("id, owner_organization_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) {
    throw new Error("リクエストが見つかりません。");
  }

  const { data: org } = await admin
    .from("organizations")
    .select("approver_teacher_id")
    .eq("id", request.owner_organization_id)
    .maybeSingle();
  if (!org || org.approver_teacher_id !== user.id) {
    throw new Error("このリクエストを判断する権限がありません(組織の承認者のみ判断できます)。");
  }
  if (request.status !== "pending") {
    throw new Error("このリクエストは既に判断済みです。");
  }

  const { error } = await admin
    .from("share_requests")
    .update({ status: decision, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) {
    throw new Error(`判断の保存に失敗しました: ${error.message}`);
  }

  revalidatePath("/organization");
}

// 先輩のAIを、同じ学校の外(同じ自治体・連携グループ)へ広げる申請を、組織の承認者が判断する。
export async function decideScopeRequestAction(personaId: string, decision: "approved" | "declined") {
  const { user } = await requireRole("teacher");
  try {
    await decideScopeRequest(createAdminClient(), { approverId: user.id, personaId, decision });
  } catch (e) {
    if (e instanceof SeniorRuleError) redirect(`/organization?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  // 承認したら、他の学校向けに特定されにくくした場面を作る(レスポンスのあとに、処理待ちを実行する)
  if (decision === "approved") scheduleJobRun();
  revalidatePath("/organization");
  redirect(`/organization?notice=${encodeURIComponent(decision === "approved" ? "承認しました。他の学校の先生が使えるようになります。" : "見送りました。")}`);
}
