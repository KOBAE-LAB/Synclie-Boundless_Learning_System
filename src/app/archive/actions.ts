"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAggregateDraft, updateAggregatePersona } from "@/lib/inquiry/aggregate";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import {
  createSeniorDraft,
  deleteSeniorPersona,
  recommendSeniorAvatar,
  SeniorRuleError,
  setSeniorAvatar,
  setSeniorStatus,
  updateSeniorPersona,
} from "@/lib/inquiry/senior";
import { requestScopeChange } from "@/lib/inquiry/share-scope";
import { SHARE_SCOPE_LABELS, isShareScope } from "@/lib/organizations/scope";

// 先輩の記録(アーカイブ)の操作。決まりは @/lib/inquiry/senior にある。決まりに反するときは、画面に理由を出す(?error=)。

async function run(fn: () => Promise<unknown>, anchor = "") {
  try {
    await fn();
  } catch (e) {
    if (e instanceof SeniorRuleError) redirect(`/archive?error=${encodeURIComponent(e.message)}${anchor}`);
    throw e;
  }
  revalidatePath("/archive");
}

export async function createSeniorDraftAction(projectId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  let personaId = "";
  await run(async () => {
    personaId = (await createSeniorDraft(admin, { teacherId: user.id, projectId, nickname: String(formData.get("nickname") ?? "") })).personaId;
  });
  redirect(`/archive#persona-${personaId}`);
}

export async function updateSeniorAction(personaId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  const field = (name: string) => String(formData.get(name) ?? "");
  await run(
    () =>
      updateSeniorPersona(admin, {
        teacherId: user.id,
        personaId,
        nickname: field("nickname"),
        role: field("role"),
        tone: field("tone"),
        position: field("position"),
        goal: field("goal"),
      }),
    `#persona-${personaId}`,
  );
}

export async function setSeniorStatusAction(personaId: string, status: "draft" | "approved") {
  const { user } = await requireRole("teacher");
  await run(() => setSeniorStatus(createAdminClient(), { teacherId: user.id, personaId, status }), `#persona-${personaId}`);
}

export async function deleteSeniorAction(personaId: string) {
  const { user } = await requireRole("teacher");
  await run(() => deleteSeniorPersona(createAdminClient(), { teacherId: user.id, personaId }));
}

export async function recommendSeniorAvatarAction(personaId: string) {
  const { user } = await requireRole("teacher");
  await run(() => recommendSeniorAvatar(createAdminClient(), { teacherId: user.id, personaId }), `#persona-${personaId}`);
}

export async function setSeniorAvatarAction(personaId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const avatarId = String(formData.get("avatarId") ?? "").trim();
  await run(() => setSeniorAvatar(createAdminClient(), { teacherId: user.id, personaId, avatarId }), `#persona-${personaId}`);
}

// 集約型(0047): 前の年度の教科・科目の記録から、集約型のAIの下書きを作る。同意した学習者が3人分以上ないと作れない。
export async function createAggregateDraftAction(seriesId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  let personaId = "";
  await run(async () => {
    personaId = (await createAggregateDraft(admin, { teacherId: user.id, seriesId, nickname: String(formData.get("nickname") ?? "") })).personaId;
  });
  redirect(`/archive#persona-${personaId}`);
}

export async function updateAggregateAction(personaId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const field = (name: string) => String(formData.get(name) ?? "");
  await run(
    () =>
      updateAggregatePersona(createAdminClient(), {
        teacherId: user.id,
        personaId,
        nickname: field("nickname"),
        role: field("role"),
        tone: field("tone"),
        position: field("position"),
        goal: field("goal"),
        itemsText: field("items"),
      }),
    `#persona-${personaId}`,
  );
}

// 公開範囲を変える・広げる申請をする。狭める変更はすぐ有効。広げる申請は、組織の承認者が承認するまで有効にならない。
export async function requestScopeAction(personaId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const scope = String(formData.get("scope") ?? "");
  const networkId = String(formData.get("networkId") ?? "") || null;
  let notice = "";
  await run(async () => {
    const result = await requestScopeChange(createAdminClient(), { teacherId: user.id, personaId, requested: scope, networkId });
    const label = isShareScope(scope) ? SHARE_SCOPE_LABELS[scope] : "";
    notice = result.applied ? `公開範囲を「${label}」にしました。` : `「${label}」への公開を申請しました。組織の承認者が承認すると、有効になります。`;
  }, `#persona-${personaId}`);
  redirect(`/archive?notice=${encodeURIComponent(notice)}#persona-${personaId}`);
}
