import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { lessonName, seriesLabel } from "@/lib/courses/series";
import { seriesHasLearnerRecords, summarizeSeriesRecords } from "@/lib/courses/series-admin";
import {
  approveEnrollmentAction,
  archiveSeriesAction,
  carryOverSeriesAction,
  clearEnrollmentsAction,
  copyEnrollmentsAction,
  createLessonAction,
  deleteSeriesAction,
  forceDeleteSeriesAction,
  unarchiveSeriesAction,
  regenerateJoinCodeAction,
  registerStudentAction,
  removeEnrollmentAction,
  updateSeriesAction,
} from "./actions";

// 教科・科目(科目・講座)のページ。担当教師が、授業回(第1回、第2回…)を重ね、履修登録(授業コード・承認)を管理する。
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
    .select("id, title, subject, join_code, owner_teacher_id, planned_lessons, fiscal_year, archived_at")
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

  const canPurge = await isAdmin(admin, user.id);
  const hasRecords = await seriesHasLearnerRecords(admin, seriesId);
  const recordSummary = hasRecords ? await summarizeSeriesRecords(admin, seriesId) : null;
  const { data: otherSeries } = await admin
    .from("course_series")
    .select("id, title, fiscal_year")
    .eq("owner_teacher_id", user.id)
    .is("archived_at", null)
    .neq("id", seriesId)
    .order("created_at", { ascending: false });
  const lessonCount = (lessons ?? []).length;

  const boundRegenerateJoinCodeAction = regenerateJoinCodeAction.bind(null, seriesId);
  const boundRegisterStudentAction = registerStudentAction.bind(null, seriesId);
  const nextLessonNo = Math.max(0, ...(lessons ?? []).map((l) => l.lesson_no)) + 1;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current={series.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{seriesLabel(series.title, series.planned_lessons)}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {series.fiscal_year}年度{series.subject ? `・${series.subject}` : ""}
        {series.planned_lessons ? `・作成済み ${lessonCount}/${series.planned_lessons}回` : `・${lessonCount}回`}
      </p>
      {series.archived_at && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          <span>この教科・科目はアーカイブ済みです。新しい履修登録・発言・提出は受け付けず、学習者は記録を見返せます。</span>
          <form action={unarchiveSeriesAction.bind(null, seriesId)}>
            <SubmitButton pendingText="戻しています…" className="rounded-md border border-warn px-3 py-1.5 text-xs font-medium hover:bg-surface-raised disabled:opacity-50">
              アーカイブを解除する
            </SubmitButton>
          </form>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">名前・全回数・年度を変える</summary>
        <form action={updateSeriesAction.bind(null, seriesId)} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="series-title" className="sr-only">教科・科目の名前</label>
          <input id="series-title" name="title" defaultValue={series.title} required maxLength={80} className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-subject" className="sr-only">補足</label>
          <input id="series-subject" name="subject" defaultValue={series.subject ?? ""} placeholder="補足(任意。例: 中学1年)" maxLength={40} className="w-48 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-planned" className="sr-only">全回数</label>
          <input id="series-planned" name="plannedLessons" type="number" min={1} max={60} defaultValue={series.planned_lessons ?? ""} placeholder="全◯回" className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
          <label htmlFor="series-year" className="sr-only">年度</label>
          <input id="series-year" name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year} className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
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

        {!series.archived_at && (
        <details open={(lessons ?? []).length === 0} className="mt-4 rounded-lg border border-line p-5">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            第{nextLessonNo}回を作成する{series.planned_lessons ? `(全${series.planned_lessons}回)` : ""}
          </summary>
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
            {lessonCount > 0 && (
              <label className="flex items-start gap-2 text-sm text-ink-muted">
                <input type="checkbox" name="inherit" defaultChecked className="mt-1" />
                <span>前の回の擬似メンバーと評価の観点を引き継ぐ(同じメンバーで続けられます)</span>
              </label>
            )}
            <SubmitButton pendingText="作成中…" className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
              作成する
            </SubmitButton>
          </form>
        </details>
        )}
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">2. 履修登録</h2>
        <p className="mt-2 text-sm text-ink-muted">授業コードを伝え、申請を承認します。教科・科目の全授業回に共通です。</p>
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


      <section className="mt-10" id="manage">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">3. 年度の処理・教科・科目の管理</h2>
        <div className="mt-4 space-y-3">
          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">翌年度へ引き継ぐ(複製)</summary>
            <p className="mt-2 text-sm text-ink-muted">
              授業回・資料・擬似メンバー・評価の観点・学習の流れを、新しい年度の教科・科目に複製します。授業回は「準備中」で作られ、
              履修者・学習者の記録は引き継ぎません(授業コードも新しくなります)。資料の知識ベースは、複製先で改めて生成します。
            </p>
            <form action={carryOverSeriesAction.bind(null, seriesId)} className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="carry-year" className="text-xs text-ink-muted">新しい年度</label>
              <input id="carry-year" name="fiscalYear" type="number" min={2000} max={2100} defaultValue={series.fiscal_year + 1} className="w-24 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
              <SubmitButton pendingText="複製中…" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                複製して引き継ぐ
              </SubmitButton>
            </form>
          </details>

          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">履修者の一括整理</summary>
            <p className="mt-2 text-sm text-ink-muted">年度末に、履修者をまとめて別の教科・科目に登録したり、履修登録を外したりします。学習者の記録は消えません。</p>
            {(otherSeries ?? []).length > 0 ? (
              <form action={copyEnrollmentsAction.bind(null, seriesId)} className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor="copy-target" className="text-xs text-ink-muted">承認済みの{enrolledStudentIds.length}人を、次の教科・科目にも登録</label>
                <select id="copy-target" name="targetSeriesId" required defaultValue="" className="min-w-0 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
                  <option value="" disabled>教科・科目を選ぶ</option>
                  {(otherSeries ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.title}({o.fiscal_year}年度)</option>
                  ))}
                </select>
                <SubmitButton pendingText="登録中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  登録する
                </SubmitButton>
              </form>
            ) : (
              <p className="mt-3 text-xs text-ink-faint">登録先にできる(アーカイブしていない)他の教科・科目がありません。</p>
            )}
            <form action={clearEnrollmentsAction.bind(null, seriesId)} className="mt-3 border-t border-line pt-3">
              <p className="text-xs text-ink-muted">この教科・科目の履修登録を、全員分(申請中も)外します。学習者は、この教科・科目の授業回を開けなくなります。</p>
              <SubmitButton pendingText="整理中…" className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-danger hover:bg-surface disabled:opacity-50">
                履修登録を全員分外す
              </SubmitButton>
            </form>
          </details>

          {!series.archived_at && (
            <details className="rounded-lg border border-line p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">アーカイブする(年度末に教科・科目を閉じる)</summary>
              <p className="mt-2 text-sm text-ink-muted">
                新しい履修登録・発言・提出を受け付けなくなります。学習者は記録を見返せます。いつでも解除できます。
              </p>
              <form action={archiveSeriesAction.bind(null, seriesId)} className="mt-3">
                <SubmitButton pendingText="処理中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  アーカイブする
                </SubmitButton>
              </form>
            </details>
          )}

          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-danger">教科・科目を削除する(テストデータの消去を含む)</summary>
            {hasRecords ? (
              <div className="mt-2 space-y-3 text-sm text-ink-muted">
                <p>
                  授業回・資料・擬似メンバー・評価の観点・学習の流れを削除します。<b>元に戻せません。</b>
                  学習者{recordSummary?.learners ?? 0}人分の記録(対話・提出物・振り返り・手書き画像・音声)は消えず、
                  授業名の控えとともに、学習者のポートフォリオに残ります。年度の途中なら、ふだんは「アーカイブ」を使ってください。
                </p>
                <form action={deleteSeriesAction.bind(null, seriesId)}>
                  <SubmitButton pendingText="削除中…" className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    授業の構成を削除する(記録は残す)
                  </SubmitButton>
                </form>
                {canPurge ? (
                  <div className="rounded-md border border-danger p-3">
                    <p className="font-medium text-danger">テストデータの消去(管理者のみ・学習者の記録ごと完全に削除)</p>
                    <p className="mt-1">
                      導入初期のテストデータを片付けるための機能です。本物の学習者の記録には使わないでください。
                      記録のある学習者{recordSummary?.learners ?? 0}人分の、対話{recordSummary?.sessions ?? 0}件・提出物{recordSummary?.submissions ?? 0}件を、
                      フィードバック・振り返り・ポートフォリオの評価・手書き画像・音声も含めてすべて削除します。
                      <b>元に戻せません。</b>
                    </p>
                    {series.archived_at ? (
                      <form action={forceDeleteSeriesAction.bind(null, seriesId)} className="mt-3 space-y-2">
                        <label htmlFor="force-confirm" className="block text-xs text-ink-muted">
                          確認のため、教科・科目名「{series.title}」を入力してください
                        </label>
                        <input id="force-confirm" name="confirmTitle" required autoComplete="off" className="w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
                        <SubmitButton pendingText="削除中…" className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                          記録ごと完全に削除する
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="mt-2 text-xs text-warn">消去するには、先に上の「アーカイブする」で教科・科目を閉じてください。</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint">学習者の記録そのものは、教師は消せません。テストデータの消去が必要なときは、管理者に依頼してください。</p>
                )}
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-muted">
                  授業回・資料・擬似メンバーなど、この教科・科目のすべてを完全に削除します。<b>元に戻せません。</b>
                </p>
                <form action={deleteSeriesAction.bind(null, seriesId)} className="mt-3">
                  <SubmitButton pendingText="削除中…" className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                    完全に削除する
                  </SubmitButton>
                </form>
              </>
            )}
          </details>
        </div>
      </section>

      <BackLink href="/courses" label="教科・科目一覧" />
    </div>
  );
}
