// 探究プロジェクトの段階の切り替え(要件定義書14章ステップ5の決定: 教師の想定+学習者の宣言)。
// 段階が切り替わると、終わった段階の「段階の物語(当時版)」と軌跡の新しい版を作る仕事を積む。
import type { createAdminClient } from "@/lib/supabase/server";
import { enqueueJob, scheduleJobRun } from "./queue";
import { isStageKey, shouldAdvanceToExpected, type StageKey } from "./stages";

type AdminClient = ReturnType<typeof createAdminClient>;

export type StageDecidedBy = "teacher_expected" | "learner" | "teacher";

export async function transitionStage(
  admin: AdminClient,
  params: { projectId: string; to: StageKey; decidedBy: StageDecidedBy; profileId?: string | null; courseId?: string | null },
): Promise<{ changed: boolean }> {
  const { data: project } = await admin
    .from("inquiry_projects")
    .select("id, current_stage_key")
    .eq("id", params.projectId)
    .maybeSingle();
  if (!project) throw new Error("探究プロジェクトが見つかりません。");
  const from = (project.current_stage_key as string | null) ?? null;
  if (from === params.to) return { changed: false };

  // 同時に切り替えられても二重にならないよう、いまの段階が読んだときのままの場合だけ更新する。
  let update = admin.from("inquiry_projects").update({ current_stage_key: params.to }).eq("id", params.projectId);
  update = from === null ? update.is("current_stage_key", null) : update.eq("current_stage_key", from);
  const { data: updated } = await update.select("id").maybeSingle();
  if (!updated) return { changed: false };

  await admin.from("inquiry_stage_transitions").insert({
    project_id: params.projectId,
    from_stage_key: from,
    to_stage_key: params.to,
    decided_by: params.decidedBy,
    decided_by_profile: params.profileId ?? null,
    course_id: params.courseId ?? null,
  });

  // 終わった段階の物語と軌跡を作る(段階が無い状態からの最初の設定では作らない)。
  if (isStageKey(from)) {
    await enqueueJob(admin, { kind: "build_stage_story", projectId: params.projectId, stageKey: from, round: String(Date.now()) });
    scheduleJobRun({ projectId: params.projectId });
  }
  return { changed: true };
}

/** 授業回の「想定の段階」が、プロジェクトのいまの段階より先なら、そこまで進める(自動では戻さない)。 */
export async function applyExpectedStage(admin: AdminClient, projectId: string, courseId: string): Promise<void> {
  const [{ data: course }, { data: project }] = await Promise.all([
    admin.from("courses").select("expected_stage_key").eq("id", courseId).maybeSingle(),
    admin.from("inquiry_projects").select("current_stage_key").eq("id", projectId).maybeSingle(),
  ]);
  const expected = course?.expected_stage_key;
  if (!project || !isStageKey(expected) || !shouldAdvanceToExpected(project.current_stage_key, expected)) return;
  await transitionStage(admin, { projectId, to: expected, decidedBy: "teacher_expected", courseId });
}

/**
 * 探究の終了(授業シリーズのアーカイブ、要件定義書14章ステップ5): シリーズの各プロジェクトについて、
 * いまの段階の物語(当時版)と、振り返り版を作る仕事を積む。振り返り版は、当時版ができてから作られる(積んだ順に処理する)。
 */
export async function closeInquiryForSeries(admin: AdminClient, seriesIds: string[]): Promise<void> {
  if (seriesIds.length === 0) return;
  const { data: projects } = await admin
    .from("inquiry_projects")
    .select("id, current_stage_key")
    .in("series_id", seriesIds);
  const round = `archive:${new Date().toISOString().slice(0, 10)}`;
  for (const project of projects ?? []) {
    if (isStageKey(project.current_stage_key)) {
      await enqueueJob(admin, { kind: "build_stage_story", projectId: project.id, stageKey: project.current_stage_key, round });
    }
    await enqueueJob(admin, { kind: "build_retrospective", projectId: project.id, round });
  }
  if ((projects ?? []).length > 0) scheduleJobRun();
}
