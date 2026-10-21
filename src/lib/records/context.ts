// 生ログ(①記録層)に、授業から独立した文脈を持たせる(要件定義書14章、0042)。
// - 探究プロジェクト(project_id): 記録をまとめる単位。いまは「学習者 × シリーズ」の個人プロジェクト。
// - 授業の控え(course_label): 授業回が消えても「どの授業の記録か」を読めるようにする文字列。
// 新しい記録を作るときは recordContextFor() の結果を一緒に書き込み、授業の構成を消す前には
// stampSeriesRecordContext() で、控えの抜けを埋めておく。
import type { createAdminClient } from "@/lib/supabase/server";
import { lessonFullName } from "@/lib/courses/series";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface LessonContext {
  courseId: string;
  seriesId: string;
  seriesTitle: string;
  ownerTeacherId: string | null;
  fiscalYear: number | null;
  /** 「理科1年 第3回 光の強さ」 */
  label: string;
}

export interface RecordContext {
  projectId: string | null;
  courseLabel: string | null;
}

export async function loadLessonContext(admin: AdminClient, courseId: string): Promise<LessonContext | null> {
  const { data: course } = await admin
    .from("courses")
    .select("id, title, lesson_no, series_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;
  const { data: series } = await admin
    .from("course_series")
    .select("title, owner_teacher_id, fiscal_year")
    .eq("id", course.series_id)
    .maybeSingle();
  const seriesTitle = series?.title ?? "";
  return {
    courseId: course.id,
    seriesId: course.series_id,
    seriesTitle,
    ownerTeacherId: series?.owner_teacher_id ?? null,
    fiscalYear: series?.fiscal_year ?? null,
    label: lessonFullName(seriesTitle, course.lesson_no, course.title),
  };
}

/**
 * 学習者のそのシリーズでの個人プロジェクトを取得し、無ければ作る((シリーズ, 本人)で1つ)。
 * 同時に作ろうとして一意制約にかかった場合は、作られた方を読み直す。
 */
export async function ensureSoloProject(admin: AdminClient, lesson: LessonContext, studentId: string): Promise<string> {
  const find = async () => {
    const { data } = await admin
      .from("inquiry_projects")
      .select("id")
      .eq("series_id", lesson.seriesId)
      .eq("solo_student_id", studentId)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  let projectId = await find();
  if (!projectId) {
    const { data: created, error } = await admin
      .from("inquiry_projects")
      .insert({
        series_id: lesson.seriesId,
        owner_teacher_id: lesson.ownerTeacherId,
        kind: "solo",
        solo_student_id: studentId,
        title: lesson.seriesTitle,
        fiscal_year: lesson.fiscalYear,
        series_label: lesson.seriesTitle,
      })
      .select("id")
      .single();
    if (created) projectId = created.id as string;
    else if (error?.code === "23505") projectId = await find();
    if (!projectId) throw new Error(`探究プロジェクトの作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
  }

  await admin
    .from("inquiry_project_members")
    .upsert({ project_id: projectId, student_id: studentId }, { onConflict: "project_id,student_id", ignoreDuplicates: true });
  return projectId;
}

/**
 * 新しい記録(セッション・成果)に書き込む文脈。プロジェクトの作成に失敗しても、学習自体は止めない
 * (控えだけでも書き、プロジェクトは授業の構成を消す前の stampSeriesRecordContext で補う)。
 */
export async function recordContextFor(admin: AdminClient, courseId: string, studentId: string): Promise<RecordContext> {
  const lesson = await loadLessonContext(admin, courseId);
  if (!lesson) return { projectId: null, courseLabel: null };
  try {
    return { projectId: await ensureSoloProject(admin, lesson, studentId), courseLabel: lesson.label };
  } catch (err) {
    console.error("[records] 探究プロジェクトを用意できませんでした", err);
    return { projectId: null, courseLabel: lesson.label };
  }
}

/**
 * 0042(生ログの保護)が本番のDBに入っているか。入っていないDBで授業の構成を消すと、
 * 学習者の記録が連鎖して消えてしまうため、削除の前に確かめる(列が無ければエラーになる)。
 */
export async function assertRawLogProtection(admin: AdminClient) {
  const { error } = await admin.from("learning_sessions").select("course_label, project_id").limit(1);
  if (error) {
    throw new Error(
      "データベースの更新(0042: 学習記録の保護)がまだ適用されていないため、学習者の記録があるシリーズは削除できません。管理者に連絡してください。",
    );
  }
}

/**
 * シリーズの授業の構成を消す前に、そのシリーズの記録に控えとプロジェクトの抜けが無いようにする
 * (0042の埋め戻しより後に、控えを書かない古いコードで作られた記録が残っている場合への備え)。
 */
export async function stampSeriesRecordContext(admin: AdminClient, seriesId: string) {
  const { data: lessons } = await admin.from("courses").select("id").eq("series_id", seriesId);
  for (const { id: courseId } of lessons ?? []) {
    const lesson = await loadLessonContext(admin, courseId);
    if (!lesson) continue;

    for (const table of ["learning_sessions", "submissions"] as const) {
      await admin.from(table).update({ course_label: lesson.label }).eq("course_id", courseId).is("course_label", null);
      const { data: orphans } = await admin
        .from(table)
        .select("id, student_id")
        .eq("course_id", courseId)
        .is("project_id", null);
      for (const row of orphans ?? []) {
        if (!row.student_id) continue;
        const projectId = await ensureSoloProject(admin, lesson, row.student_id);
        await admin.from(table).update({ project_id: projectId }).eq("id", row.id);
      }
    }

    const { data: steps } = await admin.from("course_steps").select("id, title, kind").eq("course_id", courseId);
    for (const step of steps ?? []) {
      await admin
        .from("step_progress")
        .update({ step_title: step.title, step_kind: step.kind, course_label: lesson.label })
        .eq("step_id", step.id)
        .is("step_title", null);
    }

    const { data: personas } = await admin.from("personas").select("id, name").eq("course_id", courseId);
    for (const persona of personas ?? []) {
      await admin.from("dialogue_turns").update({ persona_name: persona.name }).eq("persona_id", persona.id).is("persona_name", null);
    }
  }
}
