"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsSeries } from "@/lib/courses/series";
import {
  assignMember,
  createGroup,
  deleteEmptyGroup,
  GroupRuleError,
  regenerateGroupCode,
  removeMember,
  renameGroup,
} from "@/lib/inquiry/groups";

// 探究の教科・科目の人間のグループ(教師の操作)。決まりは @/lib/inquiry/groups にある。
// 決まりに反する操作(履修していない学習者の割り当てなど)は、画面に理由を出す(?group_error=)。

async function guard(seriesId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsSeries(admin, seriesId, user.id);
  return { user, admin };
}

async function run(seriesId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GroupRuleError) {
      redirect(`/series/${seriesId}?group_error=${encodeURIComponent(e.message)}#groups`);
    }
    throw e;
  }
  revalidatePath(`/series/${seriesId}`);
}

export async function createGroupAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  await run(seriesId, () => createGroup(admin, { seriesId, teacherId: user.id, title: String(formData.get("title") ?? "") }));
}

export async function assignMemberAction(seriesId: string, projectId: string, formData: FormData) {
  const { admin } = await guard(seriesId);
  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) return;
  await run(seriesId, () => assignMember(admin, { seriesId, projectId, studentId }));
}

export async function removeMemberAction(seriesId: string, projectId: string, studentId: string) {
  const { admin } = await guard(seriesId);
  await run(seriesId, () => removeMember(admin, { seriesId, projectId, studentId }));
}

export async function regenerateGroupCodeAction(seriesId: string, projectId: string) {
  const { admin } = await guard(seriesId);
  await run(seriesId, () => regenerateGroupCode(admin, { seriesId, projectId }));
}

export async function renameGroupAction(seriesId: string, projectId: string, formData: FormData) {
  const { admin } = await guard(seriesId);
  await run(seriesId, () => renameGroup(admin, { seriesId, projectId, title: String(formData.get("title") ?? "") }));
}

export async function deleteGroupAction(seriesId: string, projectId: string) {
  const { admin } = await guard(seriesId);
  await run(seriesId, () => deleteEmptyGroup(admin, { seriesId, projectId }));
}
