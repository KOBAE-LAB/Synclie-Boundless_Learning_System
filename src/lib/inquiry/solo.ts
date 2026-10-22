// 探究学習モードの「個人の探究」(2026-10-22、先生の決定: 離島の小規模校などで、グループが作れないことがある)。
// グループに入っていない学習者は、一人で探究する。議論は本人の議論、記録は本人の個人プロジェクト(kind='solo'、0042)に属し、
// テーマ(と変更の履歴)・段階は、グループと同じ仕組みで持つ。グループに入っているときは、グループのテーマを決める(setGroupTheme)。
import type { createAdminClient } from "@/lib/supabase/server";
import { ensureSoloProject } from "@/lib/records/context";
import { findActiveGroup } from "@/lib/learn/session-scope";
import { GroupRuleError, MAX_THEME } from "./groups";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SoloInquiry {
  projectId: string;
  theme: string | null;
  history: { theme: string; created_at: string }[];
}

/** 個人の探究のテーマと変更の履歴(まだ個人プロジェクトが無ければ null。読むだけで、作らない)。 */
export async function loadSoloInquiry(admin: AdminClient, seriesId: string, studentId: string): Promise<SoloInquiry | null> {
  const { data: project } = await admin
    .from("inquiry_projects")
    .select("id, theme")
    .eq("series_id", seriesId)
    .eq("solo_student_id", studentId)
    .maybeSingle();
  if (!project) return null;
  const { data: history } = await admin
    .from("inquiry_theme_changes")
    .select("theme, created_at")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(10);
  return {
    projectId: project.id as string,
    theme: (project.theme as string | null) ?? null,
    history: (history ?? []) as { theme: string; created_at: string }[],
  };
}

/** 個人の探究のテーマを決める・更新する。変更の履歴を残す。変わっていなければ何もしない。 */
export async function setSoloTheme(
  admin: AdminClient,
  input: { seriesId: string; studentId: string; theme: string },
): Promise<{ changed: boolean }> {
  const theme = input.theme.trim().replace(/\s+/g, " ").slice(0, MAX_THEME);
  if (!theme) throw new GroupRuleError("テーマを入力してください。");

  const { data: series } = await admin
    .from("course_series")
    .select("id, title, kind, archived_at, fiscal_year, owner_teacher_id")
    .eq("id", input.seriesId)
    .maybeSingle();
  if (!series) throw new GroupRuleError("教科・科目が見つかりません。");
  if (series.kind !== "inquiry") throw new GroupRuleError("テーマを決められるのは、探究学習モードの教科・科目だけです。");
  if (series.archived_at) throw new GroupRuleError("この教科・科目は終了しています。テーマの変更はできません。");
  // グループに入っているときは、個人のテーマではなく、グループのテーマを決める。
  if (await findActiveGroup(admin, input.seriesId, input.studentId)) {
    throw new GroupRuleError("グループに入っているときは、グループのテーマを決めます。");
  }

  const projectId = await ensureSoloProject(
    admin,
    {
      courseId: "",
      seriesId: series.id as string,
      seriesTitle: series.title as string,
      ownerTeacherId: (series.owner_teacher_id as string | null) ?? null,
      fiscalYear: (series.fiscal_year as number | null) ?? null,
      label: "",
    },
    input.studentId,
  );
  const { data: project } = await admin.from("inquiry_projects").select("theme").eq("id", projectId).maybeSingle();
  if (((project?.theme as string | null) ?? "") === theme) return { changed: false };
  const { error } = await admin.from("inquiry_projects").update({ theme }).eq("id", projectId);
  if (error) throw new Error(`テーマを保存できませんでした: ${error.message}`);
  const { error: historyError } = await admin
    .from("inquiry_theme_changes")
    .insert({ project_id: projectId, theme, changed_by: input.studentId });
  if (historyError) throw new Error(`テーマの履歴を保存できませんでした: ${historyError.message}`);
  return { changed: true };
}

/** 教師の画面用: その教科・科目の、個人の探究のテーマ(学習者ごと。まだ決めていなければ null)。 */
export async function loadSoloThemes(admin: AdminClient, seriesId: string): Promise<Map<string, string | null>> {
  const { data } = await admin.from("inquiry_projects").select("solo_student_id, theme").eq("series_id", seriesId).eq("kind", "solo");
  return new Map((data ?? []).map((p) => [p.solo_student_id as string, (p.theme as string | null) ?? null]));
}
