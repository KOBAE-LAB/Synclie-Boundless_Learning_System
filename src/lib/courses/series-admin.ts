import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

async function lessonIdsOf(admin: AdminClient, seriesId: string): Promise<string[]> {
  const { data } = await admin.from("courses").select("id").eq("series_id", seriesId);
  return (data ?? []).map((c) => c.id);
}

/**
 * シリーズに、学習者の記録(対話・提出・インプットの進み)が1つでもあるか。
 * あれば削除できない(学習者の記録が消えてしまうため。代わりにアーカイブする)。
 */
export async function seriesHasLearnerRecords(admin: AdminClient, seriesId: string): Promise<boolean> {
  const lessonIds = await lessonIdsOf(admin, seriesId);
  if (lessonIds.length === 0) return false;

  const [sessions, submissions, steps] = await Promise.all([
    admin.from("learning_sessions").select("id", { count: "exact", head: true }).in("course_id", lessonIds),
    admin.from("submissions").select("id", { count: "exact", head: true }).in("course_id", lessonIds),
    admin.from("course_steps").select("id").in("course_id", lessonIds),
  ]);
  if ((sessions.count ?? 0) > 0 || (submissions.count ?? 0) > 0) return true;

  const stepIds = (steps.data ?? []).map((s) => s.id);
  if (stepIds.length === 0) return false;
  const progress = await admin.from("step_progress").select("step_id", { count: "exact", head: true }).in("step_id", stepIds);
  return (progress.count ?? 0) > 0;
}

/** 学習者の記録が無いシリーズだけを、資料ファイルごと完全に削除する。 */
export async function deleteSeriesIfEmpty(admin: AdminClient, seriesId: string) {
  if (await seriesHasLearnerRecords(admin, seriesId)) {
    throw new Error("学習者の記録があるため削除できません。代わりにアーカイブしてください。");
  }

  // Storageのファイルは、DBの削除では消えないので、先にパスを控えておく。
  const lessonIds = await lessonIdsOf(admin, seriesId);
  const paths: string[] = [];
  if (lessonIds.length > 0) {
    const [{ data: materials }, { data: steps }] = await Promise.all([
      admin.from("course_materials").select("storage_path").in("course_id", lessonIds),
      admin.from("course_steps").select("video_path").in("course_id", lessonIds),
    ]);
    for (const m of materials ?? []) if (m.storage_path) paths.push(m.storage_path);
    for (const s of steps ?? []) if (s.video_path) paths.push(s.video_path);
  }

  const { error } = await admin.from("course_series").delete().eq("id", seriesId);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  if (paths.length > 0) await admin.storage.from("materials").remove(paths);
}

/**
 * 翌年度への引き継ぎ: シリーズの構成(授業回・資料・擬似メンバー・評価の観点・学習の流れ)を、新しい年度の
 * シリーズに複製する。履修者・学習者の記録・参加コードは引き継がない(新しいコードになる)。
 * 授業回は「準備中」で作る。資料のRAG(知識ベース)は、複製先で改めて生成する。
 * 学習進化型の擬似メンバー(特定の年度の学習者の記録から作られたもの)は、引き継がない。
 */
export async function carryOverSeries(
  admin: AdminClient,
  seriesId: string,
  teacherId: string,
  fiscalYear: number,
): Promise<string> {
  const { data: source } = await admin
    .from("course_series")
    .select("title, subject, planned_lessons, owner_teacher_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (!source || source.owner_teacher_id !== teacherId) {
    throw new Error("この授業シリーズを操作する権限がありません。");
  }

  const { data: created, error } = await admin
    .from("course_series")
    .insert({
      owner_teacher_id: teacherId,
      title: source.title,
      subject: source.subject,
      planned_lessons: source.planned_lessons,
      fiscal_year: fiscalYear,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`新しいシリーズの作成に失敗しました: ${error?.message ?? "不明なエラー"}`);
  const newSeriesId = created.id as string;

  const copiedPaths: string[] = [];
  try {
    const { data: lessons } = await admin
      .from("courses")
      .select("*")
      .eq("series_id", seriesId)
      .order("lesson_no", { ascending: true });

    for (const lesson of lessons ?? []) {
      const { id: oldCourseId, created_at: _c, series_id: _s, released: _r, ...settings } = lesson as Record<string, unknown>;
      void _c; void _s; void _r;
      const { data: newCourse, error: courseError } = await admin
        .from("courses")
        .insert({ ...settings, series_id: newSeriesId, released: false })
        .select("id")
        .single();
      if (courseError || !newCourse) throw new Error(`授業回の複製に失敗しました: ${courseError?.message}`);
      const newCourseId = newCourse.id as string;

      const copyFile = async (path: string, folder: string): Promise<string> => {
        const name = path.split("/").pop() ?? "file";
        const dest = `${newCourseId}/${folder}${crypto.randomUUID()}-${name.replace(/^[0-9a-f-]{36}-/, "")}`;
        const { error: copyError } = await admin.storage.from("materials").copy(path, dest);
        if (copyError) throw new Error(`ファイルの複製に失敗しました: ${copyError.message}`);
        copiedPaths.push(dest);
        return dest;
      };

      // 資料(ファイルも複製。RAGは未生成に戻す)
      const materialIdMap = new Map<string, string>();
      const { data: materials } = await admin
        .from("course_materials")
        .select("id, kind, title, storage_path, source_url")
        .eq("course_id", oldCourseId as string);
      for (const m of materials ?? []) {
        const storagePath = m.storage_path ? await copyFile(m.storage_path, "") : null;
        const { data: newMaterial, error: mError } = await admin
          .from("course_materials")
          .insert({ course_id: newCourseId, uploaded_by: teacherId, kind: m.kind, title: m.title, storage_path: storagePath, source_url: m.source_url })
          .select("id")
          .single();
        if (mError || !newMaterial) throw new Error(`資料の複製に失敗しました: ${mError?.message}`);
        materialIdMap.set(m.id, newMaterial.id as string);
      }

      // 擬似メンバー(学習進化型は除く)
      const { data: personas } = await admin
        .from("personas")
        .select("*")
        .eq("course_id", oldCourseId as string)
        .neq("tier", "evolved");
      for (const p of personas ?? []) {
        const { id: _pid, created_at: _pc, course_id: _pcid, shared_at: _ps, ...rest } = p as Record<string, unknown>;
        void _pid; void _pc; void _pcid; void _ps;
        const { error: pError } = await admin
          .from("personas")
          .insert({ ...rest, course_id: newCourseId, shared_at: null, origin_note: `${fiscalYear - 1}年度から引き継ぎ` });
        if (pError) throw new Error(`擬似メンバーの複製に失敗しました: ${pError.message}`);
      }

      // 評価の観点
      const { data: criteria } = await admin
        .from("evaluation_criteria")
        .select("label, description, position")
        .eq("course_id", oldCourseId as string);
      if ((criteria ?? []).length > 0) {
        const { error: cError } = await admin
          .from("evaluation_criteria")
          .insert((criteria ?? []).map((c) => ({ ...c, course_id: newCourseId })));
        if (cError) throw new Error(`評価の観点の複製に失敗しました: ${cError.message}`);
      }

      // 学習の流れ(資料は複製先の資料に付け替え、動画ファイルも複製)
      const { data: steps } = await admin
        .from("course_steps")
        .select("position, kind, title, instruction, material_id, video_url, video_path, minutes, check_questions")
        .eq("course_id", oldCourseId as string)
        .order("position", { ascending: true });
      for (const st of steps ?? []) {
        const videoPath = st.video_path ? await copyFile(st.video_path, "step-videos/") : null;
        const { error: sError } = await admin.from("course_steps").insert({
          course_id: newCourseId,
          position: st.position,
          kind: st.kind,
          title: st.title,
          instruction: st.instruction,
          material_id: st.material_id ? (materialIdMap.get(st.material_id) ?? null) : null,
          video_url: st.video_url,
          video_path: videoPath,
          minutes: st.minutes,
          check_questions: st.check_questions,
        });
        if (sError) throw new Error(`学習の流れの複製に失敗しました: ${sError.message}`);
      }
    }
  } catch (err) {
    // 中途半端な複製を残さない(新しいシリーズごと消し、複製したファイルも消す)。
    await admin.from("course_series").delete().eq("id", newSeriesId);
    if (copiedPaths.length > 0) await admin.storage.from("materials").remove(copiedPaths);
    throw err;
  }

  return newSeriesId;
}
