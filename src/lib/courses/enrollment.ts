import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

// 履修登録のガード。履修(参加コード・申請・承認)は「教科・科目」に持たせ、授業回(courses)は
// その教科・科目を履修している学習者だけが開ける。requireConsent()と同じ「ページ側でリダイレクトする」方式。
// 承認制: 学習者が授業コードで申請しただけ(status='pending')では参加扱いにしない。
// 授業回は、教師が「公開」するまで学習者には開けない(準備中)。ただし管理者の「学習者として表示」の
// テスト学習者は、公開前の回も確認できる(公開前に動作を確かめるため)。
export async function requireEnrollment(admin: AdminClient, courseId: string, studentId: string) {
  const enrolled = await isEnrolled(admin, courseId, studentId);
  if (!enrolled) {
    redirect("/learn?not_enrolled=1");
  }
}

/** 教科・科目を承認済みで履修しているか(授業回の公開状況は見ない)。 */
export async function isEnrolledInSeries(admin: AdminClient, seriesId: string, studentId: string): Promise<boolean> {
  const { data } = await admin
    .from("series_enrollments")
    .select("student_id")
    .eq("series_id", seriesId)
    .eq("student_id", studentId)
    .eq("status", "approved")
    .maybeSingle();
  return !!data;
}

/** この授業回を学習者が開いてよいか: 教科・科目を承認済みで履修していて、回が公開済み(テスト学習者は公開前も可)。 */
export async function isEnrolled(admin: AdminClient, courseId: string, studentId: string): Promise<boolean> {
  const { data: course } = await admin
    .from("courses")
    .select("series_id, released")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return false;
  if (!(await isEnrolledInSeries(admin, course.series_id, studentId))) return false;
  if (course.released) return true;
  const { data: profile } = await admin.from("profiles").select("test_owner_id").eq("id", studentId).maybeSingle();
  return !!profile?.test_owner_id;
}
