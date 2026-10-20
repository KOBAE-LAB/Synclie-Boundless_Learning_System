"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsSeries } from "@/lib/courses/series";
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

  const { data: existing } = await admin.from("courses").select("lesson_no").eq("series_id", seriesId);
  if ((existing?.length ?? 0) >= MAX_LESSONS) {
    throw new Error(`授業回は最大${MAX_LESSONS}回までです。`);
  }
  const lessonNo = Math.max(0, ...(existing ?? []).map((c) => c.lesson_no)) + 1;

  const { data: series } = await admin.from("course_series").select("subject").eq("id", seriesId).maybeSingle();
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

  revalidatePath(`/series/${seriesId}`);
  redirect(`/courses/${data.id}`);
}

// 授業シリーズの名前・教科の変更。
export async function updateSeriesAction(seriesId: string, formData: FormData) {
  const { admin } = await guard(seriesId);
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 40);
  if (!title) {
    throw new Error("シリーズの名前を入力してください。");
  }
  const { error } = await admin.from("course_series").update({ title, subject: subject || null }).eq("id", seriesId);
  if (error) {
    throw new Error(`更新に失敗しました: ${error.message}`);
  }
  revalidatePath(`/series/${seriesId}`);
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
