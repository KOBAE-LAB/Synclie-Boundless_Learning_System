import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";

// F01拡張(受講登録): 学習者には自分が授業コードで参加登録した授業だけを見せる
// (以前は段階1の簡易実装として全授業を無条件表示していたが、どの生徒でもどの授業にも
// 入れてしまう状態だったため、course_enrollments経由の絞り込みに直した)。
export default async function LearnCoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ not_enrolled?: string }>;
}) {
  const { user } = await requireRole("student");
  const { not_enrolled } = await searchParams;

  const admin = createAdminClient();
  await requireConsent(admin, user.id);

  const { data: enrollments } = await admin
    .from("course_enrollments")
    .select("course_id")
    .eq("student_id", user.id);
  const enrolledCourseIds = (enrollments ?? []).map((e) => e.course_id);

  const { data: courses } =
    enrolledCourseIds.length > 0
      ? await admin
          .from("courses")
          .select("id, title, subject, mode")
          .in("id", enrolledCourseIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const MODE_LABELS: Record<string, string> = {
    group: "グループワーク",
    solo_study: "独習(F19)",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">授業一覧</h1>
      <p className="mt-1 text-sm text-ink-muted">{user.name ?? user.email} さん</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <Link href="/learn/dashboard" className="hover:underline">
          学習ダッシュボード(F23)→
        </Link>
        <Link href="/learn/data" className="hover:underline">
          自分のデータ(F16)→
        </Link>
        <Link href="/learn/join" className="hover:underline">
          授業に参加する(コード入力)→
        </Link>
      </div>

      {not_enrolled && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          その授業にはまだ参加登録されていません。担当の先生から授業コードをもらい、
          <Link href="/learn/join" className="mx-1 underline">
            こちら
          </Link>
          から参加してください。
        </p>
      )}

      <ul className="mt-8 space-y-2">
        {(courses ?? []).map((course) => (
          <li key={course.id}>
            <Link
              href={`/learn/${course.id}`}
              className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
            >
              <span className="font-medium text-ink">{course.title}</span>
              {course.subject && <span className="ml-2 text-ink-muted">({course.subject})</span>}
              <span className="ml-2 text-xs text-ink-faint">[{MODE_LABELS[course.mode] ?? course.mode}]</span>
            </Link>
          </li>
        ))}
        {(!courses || courses.length === 0) && (
          <li className="text-sm text-ink-muted">
            まだ参加している授業がありません。先生から授業コードをもらったら
            <Link href="/learn/join" className="mx-1 underline">
              こちら
            </Link>
            から参加してください。
          </li>
        )}
      </ul>
    </div>
  );
}
