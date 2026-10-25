"use server";

import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { hashPassword } from "@/lib/auth/password";
import { normalizeEmail, validateSignupFields } from "@/lib/auth/signup-validation";
import { createAdminClient } from "@/lib/supabase/server";

// 自己登録(サインアップ)。AI呼び出しは課金されるため、誰でも自由に使える形にはしない:
//  - 学習者: 教師が伝える授業コードが必要。登録しても教師が承認するまで授業に入れない
//    (series_enrollments.status='pending'、承認までAIは呼べない)
//  - 教師: 登録できるが、管理者が承認するまでログインできない(profiles.approval_status='pending')
// エラーはURLのクエリ(?error=)で画面に返す(入力内容そのものはURLに載せない)。

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function readFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    email: normalizeEmail(String(formData.get("email") ?? "")),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signupStudentAction(formData: FormData) {
  const path = "/signup/student";
  const { t, lang } = await getT();
  const fields = readFields(formData);
  const code = String(formData.get("code") ?? "").trim().toUpperCase();

  const problem = validateSignupFields(fields, lang);
  if (problem) fail(path, problem);
  if (!code) fail(path, t("signup.errNeedCode"));

  const admin = createAdminClient();
  const { data: series } = await admin.from("course_series").select("id, archived_at").eq("join_code", code).maybeSingle();
  if (!series) fail(path, t("signup.errCodeNotFound"));
  if (series.archived_at) fail(path, t("signup.errEnded"));

  const studentId = crypto.randomUUID();
  const { error } = await admin.from("profiles").insert({
    id: studentId,
    email: fields.email,
    password_hash: await hashPassword(fields.password),
    role: "student",
    display_name: fields.name.trim(),
  });
  if (error) {
    fail(path, error.code === "23505" ? t("signup.errDuplicateEnroll") : t("signup.errFailed"));
  }

  const { error: enrollError } = await admin
    .from("series_enrollments")
    .insert({ series_id: series.id, student_id: studentId, status: "pending" });
  if (enrollError) {
    // 申請が作れないままアカウントだけ残らないように巻き戻す。
    await admin.from("profiles").delete().eq("id", studentId);
    fail(path, t("signup.errFailed"));
  }

  redirect("/login?registered=student");
}

export async function signupTeacherAction(formData: FormData) {
  const path = "/signup/teacher";
  const { t, lang } = await getT();
  const fields = readFields(formData);

  const problem = validateSignupFields(fields, lang);
  if (problem) fail(path, problem);

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").insert({
    id: crypto.randomUUID(),
    email: fields.email,
    password_hash: await hashPassword(fields.password),
    role: "teacher",
    display_name: fields.name.trim(),
    approval_status: "pending",
  });
  if (error) {
    fail(path, error.code === "23505" ? t("signup.errDuplicate") : t("signup.errFailed"));
  }

  redirect("/login?registered=teacher");
}
