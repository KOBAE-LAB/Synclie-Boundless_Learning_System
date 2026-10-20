import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { lessonName } from "@/lib/courses/series";
import {
  approveEnrollmentAction,
  createLessonAction,
  regenerateJoinCodeAction,
  registerStudentAction,
  removeEnrollmentAction,
  updateSeriesAction,
} from "./actions";

// 授業シリーズ(科目・講座)のページ。担当教師が、授業回(第1回、第2回…)を重ね、履修登録(授業コード・承認)を管理する。
// 資料・ペルソナ・学習の流れ・議論は、授業回ごとに持つ。

const MODE_LABELS: Record<string, string> = {
  group: "グループワーク",
  solo_study: "独習",
};

export default async function SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const { data: series } = await admin
    .from("course_series")
    .select("id, title, subject, join_code, owner_teacher_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (!series || series.owner_teacher_id !== user.id) {
    notFound();
  }

  const [{ data: lessons }, { data: enrollmentRows }] = await Promise.all([
    admin
      .from("courses")
      .select("id, title, lesson_no, mode, released")
      .eq("series_id", seriesId)
      .order("lesson_no", { ascending: true }),
    admin
      .from("series_enrollments")
      .select("student_id, status, created_at")
      .eq("series_id", seriesId)
      .order("created_at", { ascending: true }),
  ]);

  const enrolledStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "approved").map((e) => e.student_id);
  const pendingStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "pending").map((e) => e.student_id);
  const allEnrollmentStudentIds = (enrollmentRows ?? []).map((e) => e.student_id);
  const { data: enrolledProfiles } =
    allEnrollmentStudentIds.length > 0
      ? await admin.from("profiles").select("id, display_name, email").in("id", allEnrollmentStudentIds)
      : { data: [] };
  const profileById = new Map((enrolledProfiles ?? []).map((p) => [p.id, p]));

  const boundRegenerateJoinCodeAction = regenerateJoinCodeAction.bind(null, seriesId);
  const boundRegisterStudentAction = registerStudentAction.bind(null, seriesId);
  const nextLessonNo = Math.max(0, ...(lessons ?? []).map((l) => l.lesson_no)) + 1;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業シリーズ一覧", href: "/courses" }]} current={series.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{series.title}</h1>
      {series.subject && <p className="mt-1 text-sm text-ink-muted">{series.subject}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">シリーズの名前を変える</summary>
        <form action={updateSeriesAction.bind(null, seriesId)} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="series-title" className="sr-only">シリーズの名前</label>
          <input id="series-title" name="title" defaultValue={series.title} required maxLength={80} className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-subject" className="sr-only">教科</label>
          <input id="series-subject" name="subject" defaultValue={series.subject ?? ""} placeholder="教科(任意)" maxLength={40} className="w-36 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <SubmitButton pendingText="保存中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">保存</SubmitButton>
        </form>
      </details>

      <section className="mt-10">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">1. 授業回({(lessons ?? []).length}回)</h2>
        <p className="mt-2 text-sm text-ink-muted">回ごとに、資料・擬似メンバー・学習の流れを設定します。公開した回だけ、履修している学習者が開けます。</p>
        <ul className="mt-3 space-y-2">
          {(lessons ?? []).map((lesson) => (
            <li key={lesson.id}>
              <Link href={`/courses/${lesson.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">
                  {lessonName(lesson.lesson_no, lesson.title)}
                  <span className="ml-2 text-xs font-normal text-ink-faint">[{MODE_LABELS[lesson.mode] ?? lesson.mode}]</span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${lesson.released ? "bg-success-soft text-success" : "bg-warn-soft text-warn"}`}>
                  {lesson.released ? "公開中" : "準備中"}
                </span>
              </Link>
            </li>
          ))}
          {(lessons ?? []).length === 0 && <li className="text-sm text-ink-muted">まだ授業回がありません。下のフォームから作成してください。</li>}
        </ul>

        <details open={(lessons ?? []).length === 0} className="mt-4 rounded-lg border border-line p-5">
          <summary className="cursor-pointer text-sm font-medium text-ink">第{nextLessonNo}回を作成する</summary>
          <form action={createLessonAction.bind(null, seriesId)} className="mt-4 space-y-3">
            <label htmlFor="lesson-new-title" className="sr-only">授業回の名前</label>
            <input
              id="lesson-new-title"
              name="title"
              placeholder="この回の名前(例: 光の強さと光合成)"
              required
              maxLength={80}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <label htmlFor="lesson-new-mode" className="sr-only">授業の形式</label>
            <select id="lesson-new-mode" name="mode" defaultValue="group" className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm">
              <option value="group">グループワーク(対立するペルソナと議論)</option>
              <option value="solo_study">独習(「まだ分からない仲間」役のペルソナに説明する)</option>
            </select>
            <SubmitButton pendingText="作成中…" className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
              作成する
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">2. 履修登録</h2>
        <p className="mt-2 text-sm text-ink-muted">授業コードを伝え、申請を承認します。シリーズの全授業回に共通です。</p>
      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          受講登録
          <span className="ml-2 text-xs font-normal text-ink-muted">
            参加{enrolledStudentIds.length}人{pendingStudentIds.length > 0 ? `・承認待ち${pendingStudentIds.length}人` : ""}
          </span>
        </summary>
        <p className="mt-1 text-sm text-ink-muted">
          このコードを学習者に伝えます。学習者が入力すると申請になり、下の「承認待ち」で承認すると授業に入れます。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-md border border-line bg-surface-raised px-3 py-1.5 font-mono text-lg tracking-widest text-ink">
            {series.join_code}
          </span>
          <form action={boundRegenerateJoinCodeAction}>
            <button
              type="submit"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              コードを再発行する
            </button>
          </form>
        </div>

        {pendingStudentIds.length > 0 && (
          <div className="mt-4 rounded-md border border-warn bg-warn-soft p-3">
            <h3 className="text-xs font-medium text-warn">承認待ち({pendingStudentIds.length}人)</h3>
            <ul className="mt-2 space-y-1">
              {pendingStudentIds.map((studentId) => {
                const profile = profileById.get(studentId);
                const boundApproveAction = approveEnrollmentAction.bind(null, seriesId, studentId);
                const boundRejectAction = removeEnrollmentAction.bind(null, seriesId, studentId);
                return (
                  <li
                    key={studentId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="text-ink">{profile?.display_name || profile?.email || studentId}</span>
                    <span className="flex items-center gap-2">
                      <form action={boundApproveAction}>
                        <button
                          type="submit"
                          className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover"
                        >
                          承認する
                        </button>
                      </form>
                      <form action={boundRejectAction}>
                        <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                          却下する
                        </button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <h3 className="mt-4 text-xs font-medium text-ink-faint">
          参加している学習者({enrolledStudentIds.length}人)
        </h3>
        <ul className="mt-2 space-y-1">
          {enrolledStudentIds.map((studentId) => {
            const profile = profileById.get(studentId);
            const boundRemoveAction = removeEnrollmentAction.bind(null, seriesId, studentId);
            return (
              <li
                key={studentId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              >
                <span className="text-ink-muted">{profile?.display_name || profile?.email || studentId}</span>
                <form action={boundRemoveAction}>
                  <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                    参加登録を外す
                  </button>
                </form>
              </li>
            );
          })}
          {enrolledStudentIds.length === 0 && (
            <li className="text-sm text-ink-muted">まだ誰も参加していません。</li>
          )}
        </ul>

        <form action={boundRegisterStudentAction} className="mt-5 space-y-2 border-t border-line pt-4">
          <h3 className="text-xs font-medium text-ink-faint">学習者を直接登録する</h3>
          <p className="text-xs text-ink-muted">
            アカウントが無ければ、この初期パスワードで作ります(本人に伝え、ログイン後に変更してもらう)。
            既にある場合は、参加登録だけ行います。
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="reg-name">お名前</label>
            <input
              id="reg-name"
              name="name"
              required
              placeholder="お名前"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-email">メールアドレス</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              required
              placeholder="メールアドレス"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-password">初期パスワード(10文字以上)</label>
            <input
              id="reg-password"
              name="password"
              type="text"
              minLength={10}
              autoComplete="off"
              placeholder="初期パスワード(10文字以上)"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
          </div>
          <SubmitButton
            pendingText="登録中…"
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            登録する
          </SubmitButton>
        </form>
      </details>


      </section>

      <BackLink href="/courses" label="授業シリーズ一覧" />
    </div>
  );
}
