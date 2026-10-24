import { StudyModeBadge } from "@/components/study-mode-badge";
import { STUDY_MODE_LABELS, STUDY_MODE_SUMMARIES } from "@/lib/courses/study-mode";
import Link from "next/link";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { fiscalYearOfDate, seriesLabel } from "@/lib/courses/series";
import { archiveYearAction, createSeriesAction } from "./actions";
import {
  archiveSeriesAction,
  carryOverSeriesAction,
  deleteSeriesAction,
  unarchiveSeriesAction,
} from "../series/[seriesId]/actions";

// 教師のホーム。用途ごとに、はっきり区切った4つの部分に分ける(区切りが無く使いにくい、という指摘を受けた)。
//   1. 担当している教科・科目(毎日使う。一覧だけ)  2. 教科・科目をつくる  3. 年度末の処理(終了・翌年度への引き継ぎ・削除)
//   4. 管理者メニュー(管理者だけに表示。教師の承認・組織の管理)

const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; archived?: string }>;
}) {
  const { year: yearParam, archived } = await searchParams;
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

  const { data: seriesRows } = await admin
    .from("course_series")
    .select("id, title, subject, kind, planned_lessons, fiscal_year, archived_at, created_at")
    .eq("owner_teacher_id", user.id)
    .order("fiscal_year", { ascending: false })
    .order("created_at", { ascending: false });
  const allSeries = seriesRows ?? [];

  const currentYear = fiscalYearOfDate(new Date());
  const years = [...new Set([currentYear, ...allSeries.map((s) => s.fiscal_year)])].sort((a, b) => b - a);
  const selectedYear = yearParam && yearParam !== "all" ? Number.parseInt(yearParam, 10) : null;
  const showArchived = archived === "1";
  const seriesList = allSeries.filter(
    (s) => (selectedYear === null || s.fiscal_year === selectedYear) && (showArchived || !s.archived_at),
  );
  const archivedHidden = allSeries.filter(
    (s) => (selectedYear === null || s.fiscal_year === selectedYear) && s.archived_at,
  ).length;
  const seriesIds = allSeries.map((x) => x.id);

  // 各教科・科目の授業回の数・履修者の数・承認待ちの数・学習者の記録の有無(記録があれば削除できない)。
  const lessonCount = new Map<string, number>();
  const enrolledCount = new Map<string, number>();
  const pendingCount = new Map<string, number>();
  const seriesWithRecords = new Set<string>();
  if (seriesIds.length > 0) {
    const [{ data: lessons }, { data: enrollments }] = await Promise.all([
      admin.from("courses").select("id, series_id").in("series_id", seriesIds),
      admin.from("series_enrollments").select("series_id, status").in("series_id", seriesIds),
    ]);
    const seriesOfLesson = new Map<string, string>();
    for (const l of lessons ?? []) {
      seriesOfLesson.set(l.id, l.series_id);
      lessonCount.set(l.series_id, (lessonCount.get(l.series_id) ?? 0) + 1);
    }
    for (const e of enrollments ?? []) {
      const map = e.status === "pending" ? pendingCount : enrolledCount;
      map.set(e.series_id, (map.get(e.series_id) ?? 0) + 1);
    }
    const lessonIds = [...seriesOfLesson.keys()];
    if (lessonIds.length > 0) {
      const [{ data: sessions }, { data: submissions }] = await Promise.all([
        admin.from("learning_sessions").select("course_id").in("course_id", lessonIds),
        admin.from("submissions").select("course_id").in("course_id", lessonIds),
      ]);
      for (const r of [...(sessions ?? []), ...(submissions ?? [])]) {
        const sid = seriesOfLesson.get(r.course_id);
        if (sid) seriesWithRecords.add(sid);
      }
    }
  }

  const activeInYear = (y: number) => allSeries.filter((s) => s.fiscal_year === y && !s.archived_at).length;

  const sectionClass = "mt-12 border-t border-line-soft pt-8";
  const h2Class = "text-lg font-semibold text-ink";
  const introClass = "mt-1 text-sm text-ink-muted";

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">教科・科目一覧</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {user.name ?? user.email} さんが担当する授業
      </p>
      {showAdminLink && !!pendingTeacherCount && (
        <p role="status" className="mt-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-ink">
          承認待ちの教師が{pendingTeacherCount}人います。
          <a href="#admin-menu" className="ml-1 underline underline-offset-2">管理者メニューへ</a>
        </p>
      )}

      <section aria-labelledby="series-h" className="mt-8">
        <h2 id="series-h" className={h2Class}>
          担当している教科・科目({seriesList.length})
          {!showArchived && archivedHidden > 0 && (
            <span className="ml-2 text-xs font-normal text-ink-faint">終了済み{archivedHidden}件は非表示</span>
          )}
        </h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="list-year" className="block text-xs text-ink-muted">年度</label>
            <select id="list-year" name="year" defaultValue={selectedYear ? String(selectedYear) : "all"} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="all">すべて</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}年度</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-ink-muted">
            <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
            終了した教科・科目も表示
          </label>
          <button type="submit" className={small}>絞り込む</button>
        </form>
        <ul className="mt-4 space-y-2">
          {seriesList.map((series) => (
            <li key={series.id} className={`rounded-md border border-line ${series.archived_at ? "bg-surface" : ""}`}>
              <Link
                href={`/series/${series.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-surface"
              >
                <span>
                  <span className="font-medium text-ink">{seriesLabel(series.title, series.planned_lessons)}</span>
                  <span className="ml-2 text-xs text-ink-faint">{series.fiscal_year}年度</span>
                  <span className="ml-2"><StudyModeBadge kind={series.kind} /></span>
                  {series.subject && <span className="ml-2 text-ink-muted">({series.subject})</span>}
                  {series.archived_at && (
                    <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">終了</span>
                  )}
                </span>
                <span className="text-xs text-ink-muted">
                  {lessonCount.get(series.id) ?? 0}{series.planned_lessons ? `/${series.planned_lessons}` : ""}回・履修{enrolledCount.get(series.id) ?? 0}人
                  {(pendingCount.get(series.id) ?? 0) > 0 && (
                    <span className="ml-1 font-medium text-warn">・承認待ち{pendingCount.get(series.id)}人</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
          {seriesList.length === 0 && (
            <li className="text-sm text-ink-muted">
              {allSeries.length === 0 ? "まだ教科・科目がありません。下の「教科・科目をつくる」から作成してください。" : "この条件に合う教科・科目はありません。"}
            </li>
          )}
        </ul>
      </section>

      <section id="create" aria-labelledby="create-h" className={sectionClass}>
        <h2 id="create-h" className={h2Class}>教科・科目をつくる</h2>
        <p className={introClass}>つくったあとで、授業回(第1回、第2回…)をつくります。</p>
        <details open={allSeries.length === 0} className="mt-3 rounded-lg border border-line p-5">
          <summary className="cursor-pointer text-sm font-medium text-ink">新しく作成する(学習モードを選ぶ)</summary>
          <p className="mt-2 text-sm text-ink-muted">学習モードは、作成後に変えられません。</p>
          <form action={createSeriesAction} className="mt-4 space-y-3">
            <label htmlFor="series-title" className="sr-only">名前</label>
            <input
              id="series-title"
              name="title"
              placeholder="名前(例: 理科、数学I、情報、探究のテーマ名)"
              required
              maxLength={80}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <label htmlFor="series-subject" className="sr-only">補足</label>
            <input
              id="series-subject"
              name="subject"
              placeholder="補足(任意。例: 中学1年)"
              maxLength={40}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-ink-muted">
                全回数(予定。任意)
                <input name="plannedLessons" type="number" min={1} max={60} placeholder="例: 8" className="mt-1 block w-28 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm" />
              </label>
              <label className="text-xs text-ink-muted">
                年度
                <input name="fiscalYear" type="number" min={2000} max={2100} defaultValue={currentYear} className="mt-1 block w-28 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm" />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-ink-muted">学習モード(作成後は変えられません)</legend>
              {(["standard", "inquiry"] as const).map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input type="radio" name="kind" value={mode} defaultChecked={mode === "standard"} className="mt-1" />
                  <span>
                    <span className="block font-medium text-ink">{STUDY_MODE_LABELS[mode]}</span>
                    <span className="block text-xs text-ink-muted">{STUDY_MODE_SUMMARIES[mode]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <SubmitButton pendingText="作成中…" className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
              作成する
            </SubmitButton>
          </form>
        </details>
      </section>

      <section id="year-end" aria-labelledby="year-end-h" className={sectionClass}>
        <h2 id="year-end-h" className={h2Class}>年度末の処理</h2>
        <p className={introClass}>終了・翌年度への引き継ぎ・削除をします。年度末にまとめて使う操作です。</p>

        <div className="mt-4 rounded-lg border border-line p-5">
          <h3 className="text-sm font-medium text-ink">年度ごとにまとめて終了する</h3>
          <p className="mt-1 text-sm text-ink-muted">選んだ年度の教科・科目を、まとめて終了します(いつでも解除できます)。</p>
          <form action={archiveYearAction} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="archive-year" className="sr-only">年度</label>
            <select id="archive-year" name="fiscalYear" defaultValue={String(selectedYear ?? currentYear)} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              {years.map((y) => (
                <option key={y} value={y}>{y}年度({activeInYear(y)}件)</option>
              ))}
            </select>
            <SubmitButton pendingText="処理中…" className={small}>この年度をまとめて終了</SubmitButton>
          </form>
        </div>

        <h3 className="mt-6 text-sm font-medium text-ink">教科・科目ごとの処理</h3>
        <ul className="mt-2 space-y-2">
          {seriesList.map((series) => {
            const hasRecords = seriesWithRecords.has(series.id);
            return (
              <li key={series.id} className={`rounded-md border border-line px-4 py-3 ${series.archived_at ? "bg-surface" : ""}`}>
                <p className="text-sm font-medium text-ink">
                  {seriesLabel(series.title, series.planned_lessons)}
                  <span className="ml-2 text-xs font-normal text-ink-faint">{series.fiscal_year}年度</span>
                  {series.archived_at && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">終了</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {series.archived_at ? (
                    <form action={unarchiveSeriesAction.bind(null, series.id)}>
                      <SubmitButton pendingText="戻しています…" className={small}>再開する</SubmitButton>
                    </form>
                  ) : (
                    <form action={archiveSeriesAction.bind(null, series.id)}>
                      <SubmitButton pendingText="処理中…" className={small}>終了する</SubmitButton>
                    </form>
                  )}
                  <form action={carryOverSeriesAction.bind(null, series.id)} className="flex items-center gap-1">
                    <label htmlFor={`carry-${series.id}`} className="sr-only">引き継ぎ先の年度</label>
                    <input id={`carry-${series.id}`} name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year + 1} className="w-20 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs" />
                    <SubmitButton pendingText="複製中…" className={small}>翌年度へ引き継ぐ</SubmitButton>
                  </form>
                  {hasRecords ? (
                    <Link href={`/series/${series.id}#manage`} className="text-xs text-ink-muted underline underline-offset-2">
                      学習者の記録あり(削除は教科・科目のページから。記録は学習者に残ります)
                    </Link>
                  ) : (
                    <details className="inline-block">
                      <summary className="cursor-pointer text-xs text-danger underline underline-offset-2">削除…</summary>
                      <form action={deleteSeriesAction.bind(null, series.id)} className="mt-2 rounded-md border border-danger p-2 text-xs">
                        <p className="text-ink-muted">授業回・資料・擬似メンバーを含め、完全に削除します。元に戻せません。</p>
                        <SubmitButton pendingText="削除中…" className="mt-2 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          完全に削除する
                        </SubmitButton>
                      </form>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
          {seriesList.length === 0 && <li className="text-sm text-ink-muted">処理できる教科・科目がありません(上の「絞り込む」の条件を変えてください)。</li>}
        </ul>
      </section>

      {showAdminLink && (
        <section id="admin-menu" aria-labelledby="admin-h" className="mt-12 rounded-lg border border-line bg-surface p-5">
          <h2 id="admin-h" className={h2Class}>
            管理者メニュー
            <span className="ml-2 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line">管理者だけに表示</span>
          </h2>
          <p className={introClass}>教師全体の設定です。授業の設定とは別のものです。</p>
          <ul className="mt-4 space-y-2">
            <li>
              <Link href="/admin/teachers" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-raised px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">教師の承認</span>
                <span className={pendingTeacherCount ? "font-medium text-warn" : "text-ink-muted"}>
                  {pendingTeacherCount ? `${pendingTeacherCount}件が承認待ち →` : "承認待ちはありません →"}
                </span>
              </Link>
            </li>
            <li>
              <Link href="/admin/organizations" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-raised px-4 py-3 text-sm hover:bg-surface">
                <span className="font-medium text-ink">組織の管理</span>
                <span className="text-ink-muted">学校・自治体・連携グループ →</span>
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
