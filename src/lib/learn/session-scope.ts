// 「この学習者の、この授業回の議論」はどれか(探究の教科・科目のグループ対応、0044)。
//  - 通常の教科・科目: 学習者ごとの議論(learning_sessions.student_id = 本人)
//  - 探究学習モード: グループに入っていれば、グループの共有の議論(student_id は null、project_id = グループ)。
//    グループに入っていなければ、個人の探究(2026-10-22、先生の決定。離島の小規模校などで、グループが作れないことがある)。
//    個人の探究の議論は、通常の教科・科目と同じ学習者本人の議論で、記録は本人の個人プロジェクト(kind='solo')に属する。
// 議論を探す・作るコードは、ここを通すこと(学習者ごとの前提のまま書くと、グループの議論が見えなくなる)。
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type SessionScope =
  // inquiry = 探究学習モードの個人の探究(theme はその人が決めたテーマ)。通常の教科・科目では付かない。
  | { kind: "solo"; studentId: string; inquiry?: true; theme?: string | null }
  | { kind: "group"; projectId: string; groupTitle: string; theme: string | null; memberIds: string[] };

/** 授業回が探究の教科・科目か。 */
export async function isInquiryLesson(admin: AdminClient, courseId: string): Promise<{ inquiry: boolean; seriesId: string | null }> {
  const { data: course } = await admin.from("courses").select("series_id").eq("id", courseId).maybeSingle();
  if (!course) return { inquiry: false, seriesId: null };
  const { data: series } = await admin.from("course_series").select("kind").eq("id", course.series_id).maybeSingle();
  return { inquiry: series?.kind === "inquiry", seriesId: course.series_id as string };
}

/** 学習者が、その教科・科目でいま入っているグループ(1つだけ。抜けたグループは除く)。 */
export async function findActiveGroup(
  admin: AdminClient,
  seriesId: string,
  studentId: string,
): Promise<{ id: string; title: string; theme: string | null } | null> {
  const { data: memberships } = await admin
    .from("inquiry_project_members")
    .select("project_id")
    .eq("student_id", studentId)
    .is("left_at", null);
  const projectIds = (memberships ?? []).map((m) => m.project_id as string);
  if (projectIds.length === 0) return null;
  const { data: group } = await admin
    .from("inquiry_projects")
    .select("id, title, theme")
    .in("id", projectIds)
    .eq("series_id", seriesId)
    .eq("kind", "group")
    .limit(1)
    .maybeSingle();
  return group ? { id: group.id as string, title: group.title as string, theme: (group.theme as string | null) ?? null } : null;
}

/** いまのメンバー(抜けた人は除く)。AIに渡す仮の呼び名(メンバーA・B…)の順番は、参加した順。 */
export async function loadActiveMemberIds(admin: AdminClient, projectId: string): Promise<string[]> {
  const { data } = await admin
    .from("inquiry_project_members")
    .select("student_id, joined_at")
    .eq("project_id", projectId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  return (data ?? []).map((m) => m.student_id as string);
}

export async function resolveSessionScope(admin: AdminClient, courseId: string, studentId: string): Promise<SessionScope> {
  const { inquiry, seriesId } = await isInquiryLesson(admin, courseId);
  if (!inquiry || !seriesId) return { kind: "solo", studentId };
  const group = await findActiveGroup(admin, seriesId, studentId);
  if (!group) {
    // グループに入っていない: 個人の探究。テーマは、本人の個人プロジェクトにある(まだ決めていなければ null)。
    const { data: own } = await admin
      .from("inquiry_projects")
      .select("theme")
      .eq("series_id", seriesId)
      .eq("solo_student_id", studentId)
      .maybeSingle();
    return { kind: "solo", studentId, inquiry: true, theme: (own?.theme as string | null | undefined) ?? null };
  }
  return { kind: "group", projectId: group.id, groupTitle: group.title, theme: group.theme, memberIds: await loadActiveMemberIds(admin, group.id) };
}

/**
 * 議論を探す問い合わせに、範囲の条件を足す(学習者本人の議論か、グループの共有の議論か)。
 */
export function scopeSessionQuery<Q>(query: Q, scope: SessionScope): Q {
  type Filterable = { eq: (column: string, value: string) => Filterable; is: (column: string, value: null) => Filterable };
  const q = query as unknown as Filterable;
  if (scope.kind === "solo") return q.eq("student_id", scope.studentId) as unknown as Q;
  return q.eq("project_id", scope.projectId).is("student_id", null) as unknown as Q;
}

/** AIに渡すグループのメンバーの仮の呼び名(氏名はAIに送らない。同意画面の説明どおり)。参加した順に A, B, C…。 */
export function memberAlias(memberIds: string[], studentId: string | null | undefined): string {
  const i = studentId ? memberIds.indexOf(studentId) : -1;
  if (i < 0) return "メンバー";
  return `メンバー${String.fromCharCode("A".charCodeAt(0) + (i % 26))}`;
}
