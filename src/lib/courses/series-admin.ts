import { createAdminClient } from "@/lib/supabase/server";
import { assertRawLogProtection, stampSeriesRecordContext } from "@/lib/records/context";

type AdminClient = ReturnType<typeof createAdminClient>;

async function lessonIdsOf(admin: AdminClient, seriesId: string): Promise<string[]> {
  const { data } = await admin.from("courses").select("id").eq("series_id", seriesId);
  return (data ?? []).map((c) => c.id);
}

/**
 * シリーズに、学習者の記録(対話・提出・インプットの進み)が1つでもあるか。
 * 画面で、削除したときに何が残るかを説明するのに使う(記録があっても、通常の削除で記録は消えない。0042)。
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

export interface SeriesFiles {
  /** materials バケット(資料・動画ファイル) */
  materials: string[];
  /** handwriting バケット(手書き画像) */
  handwriting: string[];
  /** audio バケット(音声) */
  audio: string[];
}

/** シリーズ配下に保存されている実ファイルのパス。DBの削除では消えないので、削除の前に控える。 */
export async function collectSeriesFiles(admin: AdminClient, seriesId: string): Promise<SeriesFiles> {
  const files: SeriesFiles = { materials: [], handwriting: [], audio: [] };
  const lessonIds = await lessonIdsOf(admin, seriesId);
  if (lessonIds.length === 0) return files;

  const [{ data: materials }, { data: steps }, { data: sessions }] = await Promise.all([
    admin.from("course_materials").select("storage_path").in("course_id", lessonIds),
    admin.from("course_steps").select("video_path").in("course_id", lessonIds),
    admin.from("learning_sessions").select("id").in("course_id", lessonIds),
  ]);
  for (const m of materials ?? []) if (m.storage_path) files.materials.push(m.storage_path);
  for (const st of steps ?? []) if (st.video_path) files.materials.push(st.video_path);

  const sessionIds = (sessions ?? []).map((x) => x.id);
  if (sessionIds.length > 0) {
    const [{ data: turns }, { data: hw }, { data: au }] = await Promise.all([
      admin.from("dialogue_turns").select("source_kind, source_path").in("session_id", sessionIds).not("source_path", "is", null),
      admin.from("handwriting_uploads").select("image_path").in("session_id", sessionIds),
      admin.from("audio_uploads").select("audio_path").in("session_id", sessionIds),
    ]);
    for (const t of turns ?? []) {
      if (!t.source_path) continue;
      (t.source_kind === "audio" ? files.audio : files.handwriting).push(t.source_path);
    }
    for (const u of hw ?? []) if (u.image_path) files.handwriting.push(u.image_path);
    for (const u of au ?? []) if (u.audio_path) files.audio.push(u.audio_path);
  }
  return files;
}

async function removeSeriesFiles(admin: AdminClient, files: SeriesFiles) {
  const unique = (xs: string[]) => [...new Set(xs)];
  if (files.materials.length > 0) await admin.storage.from("materials").remove(unique(files.materials));
  if (files.handwriting.length > 0) await admin.storage.from("handwriting").remove(unique(files.handwriting));
  if (files.audio.length > 0) await admin.storage.from("audio").remove(unique(files.audio));
}

/**
 * テストデータの消去用: 学習者の記録を、外部キーの依存の順に明示的に消す。
 * 0042(生ログの保護)以降、授業の構成を消しても記録は連鎖では消えないため、ここで消す。
 * 順序: 対話ログ(論証評価・発言の修正版は連鎖で消える)→ ポートフォリオの記録 → 成果(フィードバック・振り返り・
 * ジャッジは連鎖)→ 対話セッション(手書き・音声のアップロードは連鎖)→ インプットの進み・学習計画 → 探究プロジェクト
 * (記録がプロジェクトを参照しているため最後)。
 */
async function deleteLearnerRecords(admin: AdminClient, seriesId: string) {
  const lessonIds = await lessonIdsOf(admin, seriesId);
  const check = (result: { error: { message: string } | null }, what: string) => {
    if (result.error) throw new Error(`${what}の削除に失敗しました: ${result.error.message}`);
  };

  if (lessonIds.length > 0) {
    const [{ data: sessions }, { data: steps }] = await Promise.all([
      admin.from("learning_sessions").select("id").in("course_id", lessonIds),
      admin.from("course_steps").select("id").in("course_id", lessonIds),
    ]);
    const sessionIds = (sessions ?? []).map((x) => x.id);
    const stepIds = (steps ?? []).map((x) => x.id);

    if (sessionIds.length > 0) {
      check(await admin.from("dialogue_turns").delete().in("session_id", sessionIds), "対話ログ");
      check(await admin.from("portfolio_entries").delete().in("session_id", sessionIds), "ポートフォリオの記録");
    }
    check(await admin.from("submissions").delete().in("course_id", lessonIds), "成果");
    check(await admin.from("learning_sessions").delete().in("course_id", lessonIds), "対話セッション");
    if (stepIds.length > 0) {
      check(await admin.from("step_progress").delete().in("step_id", stepIds), "インプットの進み");
    }
    check(await admin.from("study_plan_items").delete().in("course_id", lessonIds), "学習計画");
  }
  check(await admin.from("inquiry_projects").delete().eq("series_id", seriesId), "探究プロジェクト");
}

/**
 * 通常の削除(教師): 授業の構成(授業回・資料・擬似メンバー・評価の観点・学習の流れ)を、資料・動画のファイルごと
 * 完全に削除する。学習者の記録(対話・成果・振り返り・進み・手書き画像・音声)は消えず、授業の控えと探究プロジェクトを
 * 持ったまま、学習者のポートフォリオに残る(要件定義書14章の設計原則4、0042)。
 * 記録があるときは、0042がDBに入っていることを確かめ、控えの抜けを埋めてから消す。
 */
export async function deleteSeries(admin: AdminClient, seriesId: string) {
  if (await seriesHasLearnerRecords(admin, seriesId)) {
    await assertRawLogProtection(admin);
    await stampSeriesRecordContext(admin, seriesId);
  }
  // 学習者の手書き画像・音声は記録の一部なので残す。消すのは授業の構成のファイル(資料・動画)だけ。
  const { materials } = await collectSeriesFiles(admin, seriesId);
  const { error } = await admin.from("course_series").delete().eq("id", seriesId);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  await removeSeriesFiles(admin, { materials, handwriting: [], audio: [] });
}

export interface SeriesRecordSummary {
  /** 記録のある学習者の数 */
  learners: number;
  sessions: number;
  submissions: number;
}

/** 削除の前に見せる、学習者の記録の量(通常の削除では残り、テストデータの消去では消える)。 */
export async function summarizeSeriesRecords(admin: AdminClient, seriesId: string): Promise<SeriesRecordSummary> {
  const lessonIds = await lessonIdsOf(admin, seriesId);
  if (lessonIds.length === 0) return { learners: 0, sessions: 0, submissions: 0 };
  const [{ data: sessions }, { data: submissions }] = await Promise.all([
    admin.from("learning_sessions").select("student_id").in("course_id", lessonIds),
    admin.from("submissions").select("student_id").in("course_id", lessonIds),
  ]);
  const learners = new Set<string>();
  for (const r of [...(sessions ?? []), ...(submissions ?? [])]) if (r.student_id) learners.add(r.student_id);
  return { learners: learners.size, sessions: (sessions ?? []).length, submissions: (submissions ?? []).length };
}

/**
 * 強制削除(テストデータの消去、管理者のみ): 学習者の記録(対話・提出物・フィードバック・振り返り・
 * ポートフォリオの評価・進み・学習計画・探究プロジェクト・手書き画像・音声)ごと、シリーズを完全に削除する。
 * 元に戻せない。誤操作を防ぐため、(1)先にアーカイブしてあること、(2)シリーズ名を一字一句入力して確かめること、を求める。
 */
export async function forceDeleteSeries(admin: AdminClient, seriesId: string, confirmTitle: string) {
  const { data: series } = await admin.from("course_series").select("title, archived_at").eq("id", seriesId).maybeSingle();
  if (!series) throw new Error("授業シリーズが見つかりません。");
  if (!series.archived_at) throw new Error("強制削除するには、先にシリーズをアーカイブしてください。");
  if (confirmTitle.trim() !== series.title.trim()) {
    throw new Error("入力したシリーズ名が一致しません。削除する場合は、シリーズ名を正確に入力してください。");
  }

  const files = await collectSeriesFiles(admin, seriesId);
  await deleteLearnerRecords(admin, seriesId);
  const { error } = await admin.from("course_series").delete().eq("id", seriesId);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  await removeSeriesFiles(admin, files);
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
