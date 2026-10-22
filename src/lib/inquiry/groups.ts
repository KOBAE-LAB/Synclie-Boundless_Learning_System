// 探究の教科・科目の人間のグループ(0044)。グループの作成・メンバーの出入り・参加コード・テーマの更新の決まりを、ここにまとめる。
//  - グループに入れるのは、その教科・科目の「承認済みの履修者」だけ。
//  - 1つの教科・科目で、同時に入れるグループは1つだけ(別のグループに入ると、前のグループからは抜ける)。
//  - 抜けても行は消さない(left_at を立てる。誰がいつ探究に関わったかの記録)。
//  - テーマはグループのメンバーが決めて更新し、変更の履歴を残す(問いの変化も探究の一部)。
//  - アーカイブした教科・科目では、グループの出入り・テーマの変更を受け付けない。
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export class GroupRuleError extends Error {}

export const MAX_GROUP_TITLE = 40;
export const MAX_THEME = 200;
export const MAX_GROUPS_PER_SERIES = 40;

// 読み違えやすい文字(0/O、1/I/L)を除く。
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGroupCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/** 入力されたコードの正規化(大文字小文字・空白・ハイフンを無視)。 */
export function normalizeGroupCode(input: string): string {
  return input.replace(/[\s\-ー－]/g, "").toUpperCase();
}

interface SeriesRow {
  id: string;
  title: string;
  kind: string;
  archived_at: string | null;
  fiscal_year: number | null;
  owner_teacher_id: string;
}

async function loadInquirySeries(admin: AdminClient, seriesId: string): Promise<SeriesRow> {
  const { data } = await admin
    .from("course_series")
    .select("id, title, kind, archived_at, fiscal_year, owner_teacher_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (!data) throw new GroupRuleError("教科・科目が見つかりません。");
  if (data.kind !== "inquiry") throw new GroupRuleError("グループは、探究の教科・科目でだけ作れます。");
  if (data.archived_at) throw new GroupRuleError("この教科・科目は終了しています。グループの変更はできません。");
  return data as SeriesRow;
}

async function assertApprovedEnrollee(admin: AdminClient, seriesId: string, studentId: string) {
  const { data } = await admin
    .from("series_enrollments")
    .select("student_id")
    .eq("series_id", seriesId)
    .eq("student_id", studentId)
    .eq("status", "approved")
    .maybeSingle();
  if (!data) throw new GroupRuleError("この教科・科目を履修している(承認済みの)学習者だけが、グループに入れます。");
}

interface GroupRow {
  id: string;
  series_id: string | null;
  kind: string;
  title: string;
  theme: string | null;
}

/** グループを読み、その教科・科目のグループであることを確かめる(教師の操作で、別の教科・科目のグループを触らせない)。 */
export async function loadGroupInSeries(admin: AdminClient, projectId: string, seriesId: string): Promise<GroupRow> {
  const { data } = await admin
    .from("inquiry_projects")
    .select("id, series_id, kind, title, theme")
    .eq("id", projectId)
    .maybeSingle();
  if (!data || data.kind !== "group" || data.series_id !== seriesId) {
    throw new GroupRuleError("グループが見つかりません。");
  }
  return data as GroupRow;
}

export async function createGroup(
  admin: AdminClient,
  input: { seriesId: string; teacherId: string; title: string },
): Promise<{ id: string; joinCode: string }> {
  const title = input.title.trim().slice(0, MAX_GROUP_TITLE);
  if (!title) throw new GroupRuleError("グループの名前を入力してください。");
  const series = await loadInquirySeries(admin, input.seriesId);
  const { count } = await admin
    .from("inquiry_projects")
    .select("id", { count: "exact", head: true })
    .eq("series_id", input.seriesId)
    .eq("kind", "group");
  if ((count ?? 0) >= MAX_GROUPS_PER_SERIES) {
    throw new GroupRuleError(`グループは1つの教科・科目に最大${MAX_GROUPS_PER_SERIES}個までです。`);
  }
  // コードが偶然ほかのグループと重なったら、作り直す。
  for (let attempt = 0; attempt < 4; attempt++) {
    const joinCode = generateGroupCode();
    const { data, error } = await admin
      .from("inquiry_projects")
      .insert({
        series_id: input.seriesId,
        owner_teacher_id: input.teacherId,
        kind: "group",
        title,
        join_code: joinCode,
        fiscal_year: series.fiscal_year,
        series_label: series.title,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, joinCode };
    if (error?.code !== "23505") throw new Error(`グループの作成に失敗しました: ${error?.message}`);
  }
  throw new Error("グループの参加コードを作れませんでした。もう一度試してください。");
}

/** 同じ教科・科目で、ほかに入っているグループから抜ける(1教科・科目1グループ)。 */
async function leaveOtherGroups(admin: AdminClient, seriesId: string, studentId: string, keepProjectId: string) {
  const { data: memberships } = await admin
    .from("inquiry_project_members")
    .select("project_id")
    .eq("student_id", studentId)
    .is("left_at", null);
  const otherIds = (memberships ?? []).map((m) => m.project_id as string).filter((id) => id !== keepProjectId);
  if (otherIds.length === 0) return;
  const { data: others } = await admin
    .from("inquiry_projects")
    .select("id")
    .in("id", otherIds)
    .eq("series_id", seriesId)
    .eq("kind", "group");
  const ids = (others ?? []).map((p) => p.id as string).filter((id) => id !== keepProjectId);
  if (ids.length === 0) return;
  const { error } = await admin
    .from("inquiry_project_members")
    .update({ left_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .in("project_id", ids)
    .is("left_at", null);
  if (error) throw new Error(`前のグループから抜けられませんでした: ${error.message}`);
}

async function addMember(admin: AdminClient, group: GroupRow, studentId: string) {
  const seriesId = group.series_id as string;
  await assertApprovedEnrollee(admin, seriesId, studentId);
  await leaveOtherGroups(admin, seriesId, studentId, group.id);
  const { data: existing } = await admin
    .from("inquiry_project_members")
    .select("student_id, left_at")
    .eq("project_id", group.id)
    .eq("student_id", studentId)
    .maybeSingle();
  if (existing && !existing.left_at) return; // もう入っている
  const { error } = await admin
    .from("inquiry_project_members")
    .upsert(
      { project_id: group.id, student_id: studentId, joined_at: new Date().toISOString(), left_at: null },
      { onConflict: "project_id,student_id" },
    );
  if (error) throw new Error(`グループに入れませんでした: ${error.message}`);
}

/** 教師がメンバーを割り当てる。 */
export async function assignMember(admin: AdminClient, input: { seriesId: string; projectId: string; studentId: string }) {
  await loadInquirySeries(admin, input.seriesId);
  const group = await loadGroupInSeries(admin, input.projectId, input.seriesId);
  await addMember(admin, group, input.studentId);
}

/** 教師がメンバーを外す(記録は残る)。 */
export async function removeMember(admin: AdminClient, input: { seriesId: string; projectId: string; studentId: string }) {
  await loadInquirySeries(admin, input.seriesId);
  await loadGroupInSeries(admin, input.projectId, input.seriesId);
  const { error } = await admin
    .from("inquiry_project_members")
    .update({ left_at: new Date().toISOString() })
    .eq("project_id", input.projectId)
    .eq("student_id", input.studentId)
    .is("left_at", null);
  if (error) throw new Error(`メンバーを外せませんでした: ${error.message}`);
}

/** 学習者が参加コードでグループに入る。入ったグループを返す。 */
export async function joinByCode(
  admin: AdminClient,
  input: { code: string; studentId: string },
): Promise<{ projectId: string; seriesId: string; title: string }> {
  const code = normalizeGroupCode(input.code);
  if (!code) throw new GroupRuleError("グループの参加コードを入力してください。");
  const { data } = await admin
    .from("inquiry_projects")
    .select("id, series_id, kind, title, theme")
    .eq("join_code", code)
    .maybeSingle();
  if (!data || data.kind !== "group" || !data.series_id) {
    throw new GroupRuleError("そのコードのグループは見つかりません。");
  }
  const group = data as GroupRow;
  await loadInquirySeries(admin, group.series_id as string);
  await addMember(admin, group, input.studentId);
  return { projectId: group.id, seriesId: group.series_id as string, title: group.title };
}

/** 学習者が自分でグループを抜ける。 */
export async function leaveGroup(admin: AdminClient, input: { projectId: string; studentId: string }) {
  const { data: group } = await admin.from("inquiry_projects").select("series_id, kind").eq("id", input.projectId).maybeSingle();
  if (!group || group.kind !== "group" || !group.series_id) throw new GroupRuleError("グループが見つかりません。");
  await loadInquirySeries(admin, group.series_id as string);
  const { error } = await admin
    .from("inquiry_project_members")
    .update({ left_at: new Date().toISOString() })
    .eq("project_id", input.projectId)
    .eq("student_id", input.studentId)
    .is("left_at", null);
  if (error) throw new Error(`グループを抜けられませんでした: ${error.message}`);
}

/** いまのメンバーか。 */
export async function isActiveMember(admin: AdminClient, projectId: string, studentId: string): Promise<boolean> {
  const { data } = await admin
    .from("inquiry_project_members")
    .select("student_id")
    .eq("project_id", projectId)
    .eq("student_id", studentId)
    .is("left_at", null)
    .maybeSingle();
  return Boolean(data);
}

/** グループのメンバーがテーマを決める・更新する。変更の履歴を残す。変わっていなければ何もしない。 */
export async function setGroupTheme(
  admin: AdminClient,
  input: { projectId: string; studentId: string; theme: string },
): Promise<{ changed: boolean }> {
  const theme = input.theme.trim().replace(/\s+/g, " ").slice(0, MAX_THEME);
  if (!theme) throw new GroupRuleError("テーマを入力してください。");
  const { data: group } = await admin
    .from("inquiry_projects")
    .select("id, series_id, kind, theme")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!group || group.kind !== "group" || !group.series_id) throw new GroupRuleError("グループが見つかりません。");
  await loadInquirySeries(admin, group.series_id as string);
  if (!(await isActiveMember(admin, input.projectId, input.studentId))) {
    throw new GroupRuleError("テーマを変えられるのは、このグループのメンバーだけです。");
  }
  if ((group.theme ?? "") === theme) return { changed: false };
  const { error } = await admin.from("inquiry_projects").update({ theme }).eq("id", input.projectId);
  if (error) throw new Error(`テーマを保存できませんでした: ${error.message}`);
  const { error: historyError } = await admin
    .from("inquiry_theme_changes")
    .insert({ project_id: input.projectId, theme, changed_by: input.studentId });
  if (historyError) throw new Error(`テーマの履歴を保存できませんでした: ${historyError.message}`);
  return { changed: true };
}

/** 教師が参加コードを作り直す(漏れた・別の生徒に伝えた場合)。いまのメンバーには影響しない。 */
export async function regenerateGroupCode(admin: AdminClient, input: { seriesId: string; projectId: string }): Promise<string> {
  await loadGroupInSeries(admin, input.projectId, input.seriesId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const joinCode = generateGroupCode();
    const { error } = await admin.from("inquiry_projects").update({ join_code: joinCode }).eq("id", input.projectId);
    if (!error) return joinCode;
    if (error.code !== "23505") throw new Error(`コードの再発行に失敗しました: ${error.message}`);
  }
  throw new Error("コードを作り直せませんでした。もう一度試してください。");
}

/** 教師がグループの名前を変える。 */
export async function renameGroup(admin: AdminClient, input: { seriesId: string; projectId: string; title: string }) {
  const title = input.title.trim().slice(0, MAX_GROUP_TITLE);
  if (!title) throw new GroupRuleError("グループの名前を入力してください。");
  await loadGroupInSeries(admin, input.projectId, input.seriesId);
  const { error } = await admin.from("inquiry_projects").update({ title }).eq("id", input.projectId);
  if (error) throw new Error(`名前を変えられませんでした: ${error.message}`);
}

/**
 * 教師がグループを消す。議論の記録があるグループは消さない(記録が参照している。0042の削除ルール)。
 * まだ誰も議論していないグループ(作り間違いなど)だけを消せる。
 */
export async function deleteEmptyGroup(admin: AdminClient, input: { seriesId: string; projectId: string }) {
  await loadGroupInSeries(admin, input.projectId, input.seriesId);
  for (const table of ["learning_sessions", "submissions"] as const) {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("project_id", input.projectId);
    if ((count ?? 0) > 0) {
      throw new GroupRuleError("議論や提出の記録があるグループは消せません(記録として残ります)。メンバーを外して使わないようにしてください。");
    }
  }
  const { error } = await admin.from("inquiry_projects").delete().eq("id", input.projectId);
  if (error) throw new Error(`グループを消せませんでした: ${error.message}`);
}

export interface GroupOverview {
  id: string;
  title: string;
  theme: string | null;
  joinCode: string | null;
  members: { studentId: string; joinedAt: string }[];
  themeHistory: { theme: string; changedBy: string | null; createdAt: string }[];
}

/** 教科・科目のグループ一覧(いまのメンバー・テーマの履歴つき)。 */
export async function loadSeriesGroups(admin: AdminClient, seriesId: string): Promise<GroupOverview[]> {
  const { data: groups } = await admin
    .from("inquiry_projects")
    .select("id, title, theme, join_code, created_at")
    .eq("series_id", seriesId)
    .eq("kind", "group")
    .order("created_at", { ascending: true });
  const ids = (groups ?? []).map((g) => g.id as string);
  if (ids.length === 0) return [];
  const [{ data: members }, { data: history }] = await Promise.all([
    admin
      .from("inquiry_project_members")
      .select("project_id, student_id, joined_at")
      .in("project_id", ids)
      .is("left_at", null)
      .order("joined_at", { ascending: true }),
    admin
      .from("inquiry_theme_changes")
      .select("project_id, theme, changed_by, created_at")
      .in("project_id", ids)
      .order("created_at", { ascending: false }),
  ]);
  return (groups ?? []).map((g) => ({
    id: g.id as string,
    title: g.title as string,
    theme: (g.theme as string | null) ?? null,
    joinCode: (g.join_code as string | null) ?? null,
    members: (members ?? [])
      .filter((m) => m.project_id === g.id)
      .map((m) => ({ studentId: m.student_id as string, joinedAt: m.joined_at as string })),
    themeHistory: (history ?? [])
      .filter((h) => h.project_id === g.id)
      .map((h) => ({ theme: h.theme as string, changedBy: (h.changed_by as string | null) ?? null, createdAt: h.created_at as string })),
  }));
}

/**
 * 履修登録を外したときに、その教科・科目のグループからも抜けさせる(履修していない人がグループの議論に残らないように)。
 * studentIds を省くと、教科・科目の全員。記録は残る(left_at を立てるだけ)。
 */
export async function leaveSeriesGroups(admin: AdminClient, seriesId: string, studentIds?: string[]) {
  const { data: groups } = await admin.from("inquiry_projects").select("id").eq("series_id", seriesId).eq("kind", "group");
  const ids = (groups ?? []).map((g) => g.id as string);
  if (ids.length === 0) return;
  let query = admin
    .from("inquiry_project_members")
    .update({ left_at: new Date().toISOString() })
    .in("project_id", ids)
    .is("left_at", null);
  if (studentIds) query = query.in("student_id", studentIds);
  const { error } = await query;
  if (error) throw new Error(`グループからの脱退に失敗しました: ${error.message}`);
}
