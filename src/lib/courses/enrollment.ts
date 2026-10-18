import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

// F01拡張: 受講登録。教師が発行した授業コード(courses.join_code)で学習者が
// 参加登録(course_enrollments)した授業だけを見せる・使わせるためのガード。
// requireConsent()と同じ「ページ側でリダイレクトする」方式にしている。
// 承認制: 学習者が授業コードで申請しただけ(status='pending')では参加扱いにしない。
// 教師が承認する(または教師が直接登録する)と status='approved' になり、初めて入れる。
export async function requireEnrollment(admin: AdminClient, courseId: string, studentId: string) {
  const enrolled = await isEnrolled(admin, courseId, studentId);
  if (!enrolled) {
    redirect("/learn?not_enrolled=1");
  }
}

export async function isEnrolled(admin: AdminClient, courseId: string, studentId: string): Promise<boolean> {
  const { data } = await admin
    .from("course_enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .eq("status", "approved")
    .maybeSingle();
  return !!data;
}
