"use server";

import { getT } from "@/lib/i18n/server";
import type { DictKey, Vars } from "@/lib/i18n/translate";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";

// 画面の言語でのメッセージ(エラーなど)。
async function msg(key: DictKey, vars?: Vars): Promise<string> {
  return (await getT()).t(key, vars);
}

// F17: LTIを経由しない直接起動(Deep Linkingを使っていないツール配置URLからの起動)で、
// まだSynclieの授業が紐づいていないリソースリンクに、教師がこの場で授業を割り当てる。
// (Deep Linkingを実際に使う場合は /courses/lti-deep-link/submit の方を通る)
export async function linkResourceDirectlyAction(formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const courseId = String(formData.get("courseId") ?? "");
  const issuer = String(formData.get("issuer") ?? "");
  const deploymentId = String(formData.get("deploymentId") ?? "");
  const resourceLinkId = String(formData.get("resourceLinkId") ?? "");
  if (!courseId || !issuer || !deploymentId || !resourceLinkId) {
    throw new Error((await msg("ltiActions.badRequest")));
  }

  await assertOwnsCourse(admin, courseId, user.id);

  const { error } = await admin.from("lti_resource_links").upsert(
    { course_id: courseId, issuer, deployment_id: deploymentId, resource_link_id: resourceLinkId },
    { onConflict: "issuer,deployment_id,resource_link_id" },
  );
  if (error) {
    throw new Error(await msg("ltiActions.linkFailed", { message: error.message }));
  }

  redirect(`/courses/${courseId}`);
}
