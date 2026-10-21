"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { addLoan, removeLoan, SeniorRuleError, updateLoan, type SeniorMode } from "@/lib/inquiry/senior";

// 授業回に先輩のAIを加える・外す・使い方(当時/振り返り)を変える。決まりは @/lib/inquiry/senior にある。

async function run(courseId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof SeniorRuleError) redirect(`/courses/${courseId}/personas?senior_error=${encodeURIComponent(e.message)}#seniors`);
    throw e;
  }
  revalidatePath(`/courses/${courseId}/personas`);
  revalidatePath(`/learn/${courseId}`);
}

const modeOf = (value: FormDataEntryValue | null): SeniorMode => (value === "retrospective" ? "retrospective" : "then");

export async function addSeniorLoanAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const personaId = String(formData.get("personaId") ?? "");
  if (!personaId) return;
  await run(courseId, () => addLoan(createAdminClient(), { teacherId: user.id, courseId, personaId, mode: modeOf(formData.get("mode")) }));
}

export async function setSeniorLoanModeAction(courseId: string, loanId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  await run(courseId, () => updateLoan(createAdminClient(), { teacherId: user.id, courseId, loanId, mode: modeOf(formData.get("mode")) }));
}

export async function setSeniorLoanStatusAction(courseId: string, loanId: string, status: "active" | "paused") {
  const { user } = await requireRole("teacher");
  await run(courseId, () => updateLoan(createAdminClient(), { teacherId: user.id, courseId, loanId, status }));
}

export async function removeSeniorLoanAction(courseId: string, loanId: string) {
  const { user } = await requireRole("teacher");
  await run(courseId, () => removeLoan(createAdminClient(), { teacherId: user.id, courseId, loanId }));
}
