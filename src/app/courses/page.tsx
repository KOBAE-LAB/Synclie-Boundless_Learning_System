import Link from "next/link";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { createCourseAction } from "./actions";

export default async function CoursesPage() {
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const showAdminLink = await isAdmin(admin, user.id);
  const { count: pendingTeacherCount } = showAdminLink
    ? await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "teacher")
        .eq("approval_status", "pending")
    : { count: 0 };

  const { data: courses } = await admin
    .from("courses")
    .select("id, title, subject, mode, created_at")
    .eq("owner_teacher_id", user.id)
    .order("created_at", { ascending: false });

  const MODE_LABELS: Record<string, string> = {
    group: "グループワーク",
    solo_study: "独習(F19)",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">授業一覧</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {user.name ?? user.email} さんが担当する授業(F01: 授業・資料の登録)
      </p>
      {showAdminLink && (
        <Link
          href="/admin/teachers"
          className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm hover:bg-surface-raised"
        >
          <span className="font-medium text-ink">教師の承認(管理者)</span>
          <span className={pendingTeacherCount ? "font-medium text-warn" : "text-ink-muted"}>
            {pendingTeacherCount ? `${pendingTeacherCount}件が承認待ち →` : "承認待ちはありません →"}
          </span>
        </Link>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">担当している授業({(courses ?? []).length})</h2>
      <ul className="mt-3 space-y-2">
        {(courses ?? []).map((course) => (
          <li key={course.id}>
            <Link
              href={`/courses/${course.id}`}
              className="block rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
            >
              <span className="font-medium text-ink">{course.title}</span>
              {course.subject && (
                <span className="ml-2 text-ink-muted">({course.subject})</span>
              )}
              <span className="ml-2 text-xs text-ink-faint">[{MODE_LABELS[course.mode] ?? course.mode}]</span>
            </Link>
          </li>
        ))}
        {(!courses || courses.length === 0) && (
          <li className="text-sm text-ink-muted">まだ授業がありません。下の「新しい授業を作成」から作成してください。</li>
        )}
      </ul>

      <details open={(courses ?? []).length === 0} className="mt-6 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">新しい授業を作成</summary>
      <form action={createCourseAction} className="mt-4 space-y-3">
        <label htmlFor="course-title" className="sr-only">
          授業名
        </label>
        <input
          id="course-title"
          name="title"
          placeholder="授業名(例: 情報活用能力の育成)"
          required
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <label htmlFor="course-subject" className="sr-only">
          教科
        </label>
        <input
          id="course-subject"
          name="subject"
          placeholder="教科(任意)"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <label htmlFor="course-mode" className="sr-only">
          授業の形式
        </label>
        <select
          id="course-mode"
          name="mode"
          defaultValue="group"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        >
          <option value="group">グループワーク(複数の学習者、対立するペルソナと議論)</option>
          <option value="solo_study">独習(F19。「まだ分からない仲間」役のペルソナに説明する)</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          作成する
        </button>
      </form>
      </details>
    </div>
  );
}
