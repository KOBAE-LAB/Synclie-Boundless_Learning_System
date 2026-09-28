"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { generateMaterialRag } from "@/lib/rag/generate";
import { assertOwnsCourse } from "@/lib/courses/ownership";

const MATERIAL_KINDS = ["syllabus", "pdf", "word", "ppt", "text", "video_subtitle", "url"] as const;
type MaterialKind = (typeof MATERIAL_KINDS)[number];

function isMaterialKind(value: unknown): value is MaterialKind {
  return typeof value === "string" && (MATERIAL_KINDS as readonly string[]).includes(value);
}

// F01: 授業・資料の登録。ファイル(PDF/Word/PPT/テキスト/動画字幕)はSupabase Storageへ、
// URL資料はメタデータのみ course_materials に保存する。
// 実際にRAG(F02)へ回す処理は別タスクで実装する(rag_status='pending'のまま残す)。
export async function uploadMaterialAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");

  const kindRaw = formData.get("kind");
  if (!isMaterialKind(kindRaw)) {
    throw new Error("資料の種類を選択してください。");
  }
  const kind = kindRaw;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    throw new Error("資料のタイトルを入力してください。");
  }

  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  let storagePath: string | null = null;
  let sourceUrl: string | null = null;

  if (kind === "url") {
    sourceUrl = String(formData.get("url") ?? "").trim();
    if (!sourceUrl) {
      throw new Error("URLを入力してください。");
    }
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("ファイルを選択してください。");
    }
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${courseId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await admin.storage
      .from("materials")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      throw new Error(`アップロードに失敗しました: ${uploadError.message}`);
    }
    storagePath = path;
  }

  const { error: insertError } = await admin.from("course_materials").insert({
    course_id: courseId,
    uploaded_by: user.id,
    kind,
    title,
    storage_path: storagePath,
    source_url: sourceUrl,
  });

  if (insertError) {
    throw new Error(`資料の登録に失敗しました: ${insertError.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

// F02: 資料を1件、RAG(分割・埋め込み)にかける。
// 失敗しても rag_status='failed' + rag_error に理由が入るだけなので、ここでは投げ直さない
// (教師が画面上でエラー内容を見て、資料を直してから「再生成」できるようにする)。
export async function generateMaterialRagAction(courseId: string, materialId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: material } = await admin
    .from("course_materials")
    .select("id, course_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!material || material.course_id !== courseId) {
    throw new Error("資料が見つかりません。");
  }

  try {
    await generateMaterialRag(materialId);
  } catch {
    // ステータス更新は generateMaterialRag 内で完了済み。ここでは画面を再描画するだけでよい。
  }

  revalidatePath(`/courses/${courseId}`);
}

// F21: 教材(単元の対応表=kind='syllabus')を組織の共有ライブラリに公開する。
// 「単元の対応表や擬似メンバー設定を…複製・共有」(要件定義書4章)のうち、教材側の対応。
// 教科書本文などの著作物を保存しない方針(6章)のため、共有できるのは教師が自分で作った
// syllabus種別の資料に限る(PDF等の複製配布は行わない)。
export async function shareMaterialAction(courseId: string, materialId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: material } = await admin
    .from("course_materials")
    .select("id, course_id, kind")
    .eq("id", materialId)
    .maybeSingle();
  if (!material || material.course_id !== courseId) {
    throw new Error("資料が見つかりません。");
  }
  if (material.kind !== "syllabus") {
    throw new Error("単元の対応表(シラバス)以外は共有できません。");
  }

  const { error } = await admin
    .from("course_materials")
    .update({ shared_at: new Date().toISOString() })
    .eq("id", materialId);
  if (error) {
    throw new Error(`共有に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

export async function unshareMaterialAction(courseId: string, materialId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: material } = await admin
    .from("course_materials")
    .select("id, course_id")
    .eq("id", materialId)
    .maybeSingle();
  if (!material || material.course_id !== courseId) {
    throw new Error("資料が見つかりません。");
  }

  const { error } = await admin.from("course_materials").update({ shared_at: null }).eq("id", materialId);
  if (error) {
    throw new Error(`共有の取り消しに失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

// F05拡張:「テンポ」設定。学習者が沈黙している間に擬似メンバー同士で会話を
// 自動継続するかどうかの既定値(0=オフ)と、この設定を評価の参考にするかどうかを
// 教師が決める。学習者は自分の授業画面でテンポの既定値だけ自分用に上書きできるが、
// 「評価の参考にするか」は教師のこの決定がそのまま学習者側に表示される(学習者は変更不可)。
export async function updateAutoDiscussionSettingsAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const raw = Number(formData.get("tempoSeconds"));
  const tempoSeconds = Number.isFinite(raw) && raw > 0 ? raw : null;
  const affectsEvaluation = formData.get("affectsEvaluation") === "on";

  const { error } = await admin
    .from("courses")
    .update({
      auto_discussion_tempo_seconds: tempoSeconds,
      auto_discussion_affects_evaluation: affectsEvaluation,
    })
    .eq("id", courseId);
  if (error) {
    throw new Error(`設定の保存に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

// F01拡張(受講登録): 授業コードを再発行する(生徒に伝えたコードが漏れた・間違って
// 別の生徒に伝えた、などの場合用)。既存の参加登録(course_enrollments)には影響しない。
export async function regenerateJoinCodeAction(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const newCode = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const { error } = await admin.from("courses").update({ join_code: newCode }).eq("id", courseId);
  if (error) {
    throw new Error(`コードの再発行に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

// F01拡張(受講登録): 参加登録を取り消す(誤って参加した生徒を外す用)。
// 対話ログ・提出物などの過去データは消さない(受講登録だけを外す)。
export async function removeEnrollmentAction(courseId: string, studentId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { error } = await admin
    .from("course_enrollments")
    .delete()
    .eq("course_id", courseId)
    .eq("student_id", studentId);
  if (error) {
    throw new Error(`参加登録の削除に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}`);
}

// F02: この授業でまだ知識ベース化されていない資料(pending/failed)をまとめて生成する。
export async function generateAllPendingRagAction(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: materials } = await admin
    .from("course_materials")
    .select("id")
    .eq("course_id", courseId)
    .in("rag_status", ["pending", "failed"]);

  for (const material of materials ?? []) {
    try {
      await generateMaterialRag(material.id);
    } catch {
      // 個別の失敗は rag_status='failed' に記録済み。他の資料の処理は続ける。
    }
  }

  revalidatePath(`/courses/${courseId}`);
}
