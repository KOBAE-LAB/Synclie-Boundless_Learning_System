import { getEffectiveStudent } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { hasConsent } from "@/lib/consent";
import { isEnrolled } from "@/lib/courses/enrollment";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveSessionScope, scopeSessionQuery } from "@/lib/learn/session-scope";

// グループの議論(0044、時間差が基本)で、ほかのメンバーやAIの新しい発言が増えたかを、画面が軽く確かめるためのAPI。
// 発言の本文は返さない(件数と、議論が終わったかだけ)。境界は発言送信API(../message)と同じ。
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { t } = await getT();
  const user = await getEffectiveStudent();
  if (!user) return Response.json({ error: t("apiErrors.login") }, { status: 401 });

  const admin = createAdminClient();
  if (!(await hasConsent(admin, user.id)) || !(await isEnrolled(admin, courseId, user.id))) {
    return Response.json({ error: t("apiErrors.noAccess") }, { status: 403 });
  }

  const scope = await resolveSessionScope(admin, courseId, user.id);
  const { data: session } = await scopeSessionQuery(
    admin.from("learning_sessions").select("id, ended_at").eq("course_id", courseId),
    scope,
  )
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return Response.json({ count: 0, ended: false }, { headers: { "Cache-Control": "no-store" } });

  const { count } = await admin
    .from("dialogue_turns")
    .select("id", { count: "exact", head: true })
    .eq("session_id", session.id);
  return Response.json({ count: count ?? 0, ended: !!session.ended_at }, { headers: { "Cache-Control": "no-store" } });
}
