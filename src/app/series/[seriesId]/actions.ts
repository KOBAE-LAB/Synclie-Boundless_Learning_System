"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsSeries, fiscalYearOfDate } from "@/lib/courses/series";
import { copyCriteriaBetweenLessons, copyPersonasBetweenLessons } from "@/lib/courses/lesson-copy";
import { carryOverSeries, deleteSeries, forceDeleteSeries } from "@/lib/courses/series-admin";
import { hashPassword } from "@/lib/auth/password";
import { normalizeEmail, validateSignupFields } from "@/lib/auth/signup-validation";

// 授業シリーズ: 教師が担当し、学習者が履修登録する単位。履修(参加コード・申請・承認・直接登録)と、
// 授業回(courses)の追加を扱う。すべて、そのシリーズの担当教師だけが操作できる。

const MAX_LESSONS = 60;

async function guard(seriesId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsSeries(admin, seriesId, user.id);
  return { user, admin };
}

// 授業回を追加する(第N回は、いちばん大きい回の次の番号)。新しい回は「準備中」で、公開するまで学習者には見えない。
export async function createLessonAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const mode = formData.get("mode") === "solo_study" ? "solo_study" : "group";
  if (!title) {
    throw new Error("授業回の名前を入力してください。");
  }

  const { data: seriesRow } = await admin.from("course_series").select("archived_at").eq("id", seriesId).maybeSingle();
  if (seriesRow?.archived_at) {
    throw new Error("アーカイブしたシリーズには、授業回を追加できません。");
  }
  const { data: existing } = await admin.from("courses").select("lesson_no").eq("series_id", seriesId);
  if ((existing?.length ?? 0) >= MAX_LESSONS) {
    throw new Error(`授業回は最大${MAX_LESSONS}回までです。`);
  }
  const lessonNo = Math.max(0, ...(existing ?? []).map((c) => c.lesson_no)) + 1;

  const { data: series } = await admin.from("course_series").select("subject").eq("id", seriesId).maybeSingle();
  // 前の回(いちばん大きい回)の擬似メンバー・評価の観点を引き継ぐ(既定でオン。初回は何もしない)。
  const previous = [...(existing ?? [])].sort((a, b) => b.lesson_no - a.lesson_no)[0];
  const { data, error } = await admin
    .from("courses")
    .insert({
      owner_teacher_id: user.id,
      series_id: seriesId,
      lesson_no: lessonNo,
      title,
      subject: series?.subject ?? null,
      mode,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`授業回の作成に失敗しました: ${error.message}`);
  }

  if (formData.get("inherit") === "on" && previous) {
    const { data: prevCourse } = await admin
      .from("courses")
      .select("id")
      .eq("series_id", seriesId)
      .eq("lesson_no", previous.lesson_no)
      .maybeSingle();
    if (prevCourse) {
      await copyPersonasBetweenLessons(admin, prevCourse.id, data.id);
      await copyCriteriaBetweenLessons(admin, prevCourse.id, data.id);
    }
  }

  revalidatePath(`/series/${seriesId}`);
  redirect(`/courses/${data.id}`);
}

function parseSeriesFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 40);
  const planned = Number.parseInt(String(formData.get("plannedLessons") ?? ""), 10);
  const year = Number.parseInt(String(formData.get("fiscalYear") ?? ""), 10);
  return {
    title,
    subject: subject || null,
    planned_lessons: Number.isInteger(planned) && planned >= 1 && planned <= 60 ? planned : null,
    fiscal_year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null,
  };
}

// 授業シリーズの名前・教科・全回数・年度の変更。
export async function updateSeriesAction(seriesId: string, formData: FormData) {
  const { admin } = await guard(seriesId);
  const fields = parseSeriesFields(formData);
  if (!fields.title) {
    throw new Error("シリーズの名前を入力してください。");
  }
  const { error } = await admin
    .from("course_series")
    .update({
      title: fields.title,
      subject: fields.subject,
      planned_lessons: fields.planned_lessons,
      ...(fields.fiscal_year ? { fiscal_year: fields.fiscal_year } : {}),
    })
    .eq("id", seriesId);
  if (error) {
    throw new Error(`更新に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
  revalidatePath("/courses");
}

// 授業コードを再発行する(伝えたコードが漏れた・間違って別の生徒に伝えた、などの場合用)。
// 既存の履修登録には影響しない。
export async function regenerateJoinCodeAction(seriesId: string) {
  const { admin } = await guard(seriesId);
  const newCode = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const { error } = await admin.from("course_series").update({ join_code: newCode }).eq("id", seriesId);
  if (error) {
    throw new Error(`コードの再発行に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
}

// 履修登録を取り消す(誤って参加した学習者を外す・申請を却下する用)。
// 対話ログ・提出物などの過去データは消さない(履修登録だけを外す)。
export async function removeEnrollmentAction(seriesId: string, studentId: string) {
  const { admin } = await guard(seriesId);
  const { error } = await admin
    .from("series_enrollments")
    .delete()
    .eq("series_id", seriesId)
    .eq("student_id", studentId);
  if (error) {
    throw new Error(`履修登録の削除に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
}

// 承認制: 学習者が授業コードで申請した履修(status='pending')を承認する。
// 承認するまでその学習者は授業に入れず、AIも呼べない。
export async function approveEnrollmentAction(seriesId: string, studentId: string) {
  const { admin } = await guard(seriesId);
  const { error } = await admin
    .from("series_enrollments")
    .update({ status: "approved" })
    .eq("series_id", seriesId)
    .eq("student_id", studentId)
    .eq("status", "pending");
  if (error) {
    throw new Error(`承認に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
}

// 教師が学習者を直接登録する(承認の手間なしにその場で履修扱いになる)。
// 学習者のアカウントがまだ無ければ、教師が決めた初期パスワードで作る
// (教師から本人へ直接伝え、本人がログイン後に「パスワード変更」で変えてもらう想定)。
// 既に同じメールアドレスの学習者がいれば、パスワードには触れずに履修登録だけ行う。
export async function registerStudentAction(seriesId: string, formData: FormData) {
  const { admin } = await guard(seriesId);

  const fields = {
    name: String(formData.get("name") ?? ""),
    email: normalizeEmail(String(formData.get("email") ?? "")),
    password: String(formData.get("password") ?? ""),
  };

  const { data: existing } = await admin
    .from("profiles")
    .select("id, role")
    .eq("email", fields.email)
    .maybeSingle();

  let studentId: string;
  if (existing) {
    if (existing.role !== "student") {
      throw new Error("そのメールアドレスは学習者以外のアカウントに使われています。");
    }
    studentId = existing.id;
  } else {
    const problem = validateSignupFields(fields);
    if (problem) throw new Error(problem);

    studentId = crypto.randomUUID();
    const { error } = await admin.from("profiles").insert({
      id: studentId,
      email: fields.email,
      password_hash: await hashPassword(fields.password),
      role: "student",
      display_name: fields.name.trim(),
    });
    if (error) {
      throw new Error(`学習者の登録に失敗しました: ${error.message}`);
    }
  }

  const { error: enrollError } = await admin
    .from("series_enrollments")
    .upsert({ series_id: seriesId, student_id: studentId, status: "approved" }, { onConflict: "series_id,student_id" });
  if (enrollError) {
    throw new Error(`履修登録に失敗しました: ${enrollError.message}`);
  }

  revalidatePath(`/series/${seriesId}`);
}

// アーカイブ(年度末などにシリーズを閉じる): 新しい履修登録・発言・提出は受け付けず、学習者は記録を見返せる。
// いつでも元に戻せる。
export async function archiveSeriesAction(seriesId: string) {
  const { admin } = await guard(seriesId);
  const { error } = await admin.from("course_series").update({ archived_at: new Date().toISOString() }).eq("id", seriesId);
  if (error) throw new Error(`アーカイブに失敗しました: ${error.message}`);
  revalidatePath(`/series/${seriesId}`);
  revalidatePath("/courses");
}

export async function unarchiveSeriesAction(seriesId: string) {
  const { admin } = await guard(seriesId);
  const { error } = await admin.from("course_series").update({ archived_at: null }).eq("id", seriesId);
  if (error) throw new Error(`元に戻せませんでした: ${error.message}`);
  revalidatePath(`/series/${seriesId}`);
  revalidatePath("/courses");
}

// 削除: 授業の構成(授業回・資料・擬似メンバーなど)を、資料ファイルごと完全に削除する(元に戻せない)。
// 学習者の記録は消えず、授業の控えとともに学習者のポートフォリオに残る(要件定義書14章、0042)。
export async function deleteSeriesAction(seriesId: string) {
  const { admin } = await guard(seriesId);
  await deleteSeries(admin, seriesId);
  revalidatePath("/courses");
  redirect("/courses");
}

// テストデータの消去(強制削除): 学習者の記録ごと完全に削除する(元に戻せない)。**管理者だけ**が使える。
// 導入初期のテストデータを片付けるための機能で、本物の学習者の記録を消すために使わない
// (一般の教師は、学習者の記録を消せない。要件定義書14章の設計原則)。
// 先にアーカイブし、シリーズ名を入力して確かめる。
export async function forceDeleteSeriesAction(seriesId: string, formData: FormData) {
  const { user } = await requireAdmin();
  const admin = createAdminClient();
  await assertOwnsSeries(admin, seriesId, user.id);
  await forceDeleteSeries(admin, seriesId, String(formData.get("confirmTitle") ?? ""));
  revalidatePath("/courses");
  redirect("/courses");
}

// 翌年度への引き継ぎ: 構成(授業回・資料・擬似メンバー・評価の観点・学習の流れ)を新しいシリーズに複製する。
export async function carryOverSeriesAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  const { data: source } = await admin.from("course_series").select("fiscal_year").eq("id", seriesId).maybeSingle();
  const requested = Number.parseInt(String(formData.get("fiscalYear") ?? ""), 10);
  const fiscalYear = Number.isInteger(requested) ? requested : (source?.fiscal_year ?? fiscalYearOfDate(new Date())) + 1;
  const newSeriesId = await carryOverSeries(admin, seriesId, user.id, fiscalYear);
  revalidatePath("/courses");
  redirect(`/series/${newSeriesId}`);
}

// 履修者の一括整理(1): 承認済みの履修者を、別のシリーズ(自分が担当する、アーカイブしていないもの)にも履修登録する。
// 元のシリーズの履修は残る(過去の記録を見返せるように)。
export async function copyEnrollmentsAction(seriesId: string, formData: FormData) {
  const { user, admin } = await guard(seriesId);
  const targetId = String(formData.get("targetSeriesId") ?? "");
  if (!targetId || targetId === seriesId) throw new Error("登録先のシリーズを選んでください。");
  await assertOwnsSeries(admin, targetId, user.id);
  const { data: target } = await admin.from("course_series").select("archived_at").eq("id", targetId).maybeSingle();
  if (target?.archived_at) throw new Error("アーカイブしたシリーズには登録できません。");

  const { data: rows } = await admin
    .from("series_enrollments")
    .select("student_id")
    .eq("series_id", seriesId)
    .eq("status", "approved");
  const records = (rows ?? []).map((r) => ({ series_id: targetId, student_id: r.student_id, status: "approved" }));
  if (records.length > 0) {
    const { error } = await admin.from("series_enrollments").upsert(records, { onConflict: "series_id,student_id" });
    if (error) throw new Error(`履修登録に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
  revalidatePath(`/series/${targetId}`);
}

// 履修者の一括整理(2): このシリーズの履修登録を全員分まとめて外す(申請中も含む)。
// 対話ログ・提出物などの学習者の記録は消さない(学習者のポートフォリオには残る)。
export async function clearEnrollmentsAction(seriesId: string) {
  const { admin } = await guard(seriesId);
  const { error } = await admin.from("series_enrollments").delete().eq("series_id", seriesId);
  if (error) throw new Error(`履修登録の整理に失敗しました: ${error.message}`);
  revalidatePath(`/series/${seriesId}`);
  revalidatePath("/courses");
}
