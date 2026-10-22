"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { hasConsent } from "@/lib/consent";
import { isEnrolledInSeries } from "@/lib/courses/enrollment";
import { findActiveGroup } from "@/lib/learn/session-scope";
import { GroupRuleError, joinByCode, leaveGroup, setGroupTheme } from "@/lib/inquiry/groups";

// 探究の教科・科目のグループ(学習者の操作): コードで入る・抜ける・テーマを決める/更新する。
// 決まりは @/lib/inquiry/groups にある。決まりに反するときは、画面に理由を出す(?group_error=)。

async function guard(seriesId: string) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  if (!(await hasConsent(admin, user.id)) || !(await isEnrolledInSeries(admin, seriesId, user.id))) {
    redirect("/learn?not_enrolled=1");
  }
  return { user, admin };
}

async function run(seriesId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GroupRuleError) {
      redirect(`/learn/series/${seriesId}?group_error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  revalidatePath(`/learn/series/${seriesId}`);
}

export async function joinGroupAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  await run(seriesId, async () => {
    const joined = await joinByCode(admin, { code: String(formData.get("code") ?? ""), studentId: user.id });
    // 別の教科・科目のグループのコードだった場合は、その教科・科目の画面へ(履修していることは joinByCode が確かめている)。
    if (joined.seriesId !== seriesId) redirect(`/learn/series/${joined.seriesId}`);
  });
}

export async function leaveGroupAction(seriesId: string) {
  const { user, admin } = await guard(seriesId);
  const group = await findActiveGroup(admin, seriesId, user.id);
  if (!group) return;
  await run(seriesId, () => leaveGroup(admin, { projectId: group.id, studentId: user.id }));
}

export async function setThemeAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  const group = await findActiveGroup(admin, seriesId, user.id);
  if (!group) redirect(`/learn/series/${seriesId}`);
  await run(seriesId, () => setGroupTheme(admin, { projectId: group.id, studentId: user.id, theme: String(formData.get("theme") ?? "") }));
}
