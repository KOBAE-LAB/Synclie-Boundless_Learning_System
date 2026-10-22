"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import {
  createSeniorDraft,
  deleteSeniorPersona,
  SeniorRuleError,
  setSeniorStatus,
  updateSeniorPersona,
} from "@/lib/inquiry/senior";

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
