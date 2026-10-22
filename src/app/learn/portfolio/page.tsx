import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { PortfolioEntryBody } from "@/components/portfolio-entry-body";
import { SubmitButton } from "@/components/submit-button";
import { RATING_LABELS, MAX_COMMENT_LENGTH } from "@/lib/portfolio/assessment";
import { loadPortfolio } from "@/lib/portfolio/load";
import { SHARE_DURATION_DAYS, shareLinkStatus } from "@/lib/portfolio/share";
import {
  createShareLinkAction,
  revokeShareLinkAction,
  saveSelfAssessmentAction,
  toggleSharedAction,
} from "./actions";

// ポートフォリオ。学習者本人の「学びのデータベース」: 全授業の成果・議論のまとめ・フィードバック・
// 振り返りを時系列で並べ、自己評価を書き、公開するものを選び、持ち出せる。
// AIの評価は材料にとどめ、最終判断は学習者本人と教師に残す(非機能要件)。

const btn = "rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:bg-surface";
const primaryBtn = "rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; year?: string }>;
}) {
  const { course: courseFilter, year: yearFilter } = await searchParams;
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);

  const portfolio = await loadPortfolio(admin, user.id);
  const courses = [...new Map(portfolio.entries.map((e) => [e.courseId, e.courseTitle])).entries()];
  const years = [...new Set(portfolio.entries.map((e) => e.fiscalYear))].sort((a, b) => b - a);
  const entries = portfolio.entries.filter(
    (e) => (!courseFilter || e.courseId === courseFilter) && (!yearFilter || String(e.fiscalYear) === yearFilter),
  );

  const { data: linkRows } = await admin
    .from("portfolio_share_links")
    .select("id, token, label, expires_at, revoked_at, created_at")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });
  const links = linkRows ?? [];
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const sharedCount = portfolio.entries.filter((e) => e.shared).length;

  const exportQuery = courseFilter ? `&course=${encodeURIComponent(courseFilter)}` : "";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current="ポートフォリオ" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">ポートフォリオ</h1>
      <p className="mt-1 text-sm text-ink-muted">
        全授業の成果・フィードバック・振り返りが、時系列で集まります。
      </p>

      <section className="mt-6 rounded-lg border border-line p-4">
        <h2 className="text-sm font-semibold text-ink">絞り込みと書き出し</h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="pf-course" className="block text-xs text-ink-muted">授業</label>
            <select id="pf-course" name="course" defaultValue={courseFilter ?? ""} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="">すべて</option>
              {courses.map(([id, title]) => (
                <option key={id} value={id}>{title}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pf-year" className="block text-xs text-ink-muted">年度</label>
            <select id="pf-year" name="year" defaultValue={yearFilter ?? ""} className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="">すべて</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}年度</option>
              ))}
            </select>
          </div>
          <button type="submit" className={btn}>絞り込む</button>
        </form>
        <p className="mt-4 text-xs text-ink-muted">書き出し(絞り込みの「授業」が反映されます):</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <a className={btn} href={`/api/learn/portfolio/export?format=html${exportQuery}`} target="_blank" rel="noreferrer">印刷・PDF用(HTML)</a>
          <a className={btn} href={`/api/learn/portfolio/export?format=md${exportQuery}`}>Markdown</a>
          <a className={btn} href={`/api/learn/portfolio/export?format=json${exportQuery}`}>JSON(データ)</a>
        </div>
        <p className="mt-2 text-xs text-ink-faint">PDFにするには、HTMLを開いてブラウザの「印刷」から「PDFに保存」を選びます。</p>
      </section>

      <section className="mt-6 rounded-lg border border-line p-4">
        <h2 className="text-sm font-semibold text-ink">公開リンク(見せる相手に渡す)</h2>
        <p className="mt-1 text-xs text-ink-muted">
          「公開用」にした成果({sharedCount}件)だけを、リンクを知る人が見られます(振り返りは含みません)。
          期限切れか取り消しで見られなくなります。
        </p>
        <form action={createShareLinkAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="pf-label" className="block text-xs text-ink-muted">メモ(任意)</label>
            <input id="pf-label" name="label" maxLength={60} placeholder="例: 新しい担任の先生用" className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="pf-days" className="block text-xs text-ink-muted">有効期間</label>
            <select id="pf-days" name="days" className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              {SHARE_DURATION_DAYS.map((d) => (
                <option key={d} value={d}>{d}日間</option>
              ))}
            </select>
          </div>
          <SubmitButton className={primaryBtn} pendingText="作成中…">リンクを作る</SubmitButton>
        </form>
        {links.length > 0 && (
          <ul className="mt-4 space-y-2">
            {links.map((l) => {
              const status = shareLinkStatus(l);
              const url = `${proto}://${host}/portfolio/shared/${l.token}`;
              return (
                <li key={l.id} className="rounded-md border border-line px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">
                      {l.label || "(メモなし)"} ・ {status === "active" ? `〜${new Date(l.expires_at).toLocaleDateString("ja-JP")}まで有効` : status === "expired" ? "期限切れ" : "取り消し済み"}
                    </span>
                    {status === "active" && (
                      <form action={revokeShareLinkAction.bind(null, l.id)}>
                        <SubmitButton className={btn} pendingText="取り消し中…">取り消す</SubmitButton>
                      </form>
                    )}
                  </div>
                  {status === "active" && (
                    <input readOnly aria-label="公開リンクのURL" value={url} className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ol className="mt-8 space-y-6">
        {entries.map((entry) => (
          <li key={entry.submissionId} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs font-medium text-ink-faint">
                {new Date(entry.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} ・ {entry.courseTitle} ・ {entry.fiscalYear}年度
              </p>
              <form action={toggleSharedAction.bind(null, entry.submissionId, !entry.shared)}>
                <SubmitButton className={entry.shared ? primaryBtn : btn} pendingText="変更中…">
                  {entry.shared ? "公開用にしている(外す)" : "公開用にする"}
                </SubmitButton>
              </form>
            </div>
            <div className="mt-3">
              <PortfolioEntryBody entry={entry} />
            </div>

            <form action={saveSelfAssessmentAction.bind(null, entry.submissionId)} className="mt-4 space-y-2 border-t border-line-soft pt-3">
              <p className="text-xs font-medium text-ink-muted">自己評価(AIの評価は材料です。決めるのはあなたです)</p>
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="sr-only">自分の評価</legend>
                {[4, 3, 2, 1].map((r) => (
                  <label key={r} className="flex items-center gap-1">
                    <input type="radio" name="rating" value={r} defaultChecked={entry.selfAssessment?.rating === r} />
                    {RATING_LABELS[r]}
                  </label>
                ))}
              </fieldset>
              <label htmlFor={`sa-${entry.submissionId}`} className="sr-only">自己評価のコメント</label>
              <textarea
                id={`sa-${entry.submissionId}`}
                name="comment"
                rows={2}
                maxLength={MAX_COMMENT_LENGTH}
                defaultValue={entry.selfAssessment?.comment ?? ""}
                placeholder="できたこと・これからやりたいこと"
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
              />
              <SubmitButton className={primaryBtn} pendingText="保存中…">自己評価を保存</SubmitButton>
            </form>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-sm text-ink-muted">
            {portfolio.entries.length === 0 ? "まだ記録がありません。授業で成果を提出すると、ここに集まります。" : "この条件に合う記録はありません。"}
          </li>
        )}
      </ol>

      <BackLink href="/learn" label="授業一覧" />
    </div>
  );
}
