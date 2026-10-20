import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { PortfolioEntryBody } from "@/components/portfolio-entry-body";
import { loadPortfolio, toSharedView } from "@/lib/portfolio/load";
import { RATING_LABELS } from "@/lib/portfolio/assessment";
import { resolveShareLink } from "@/lib/portfolio/share";

// 学習者本人が作った公開リンクの閲覧ページ(ログイン不要)。本人が「公開用」にした成果だけを見せる。
// 検索に載せない。リンクが無効(存在しない・期限切れ・取り消し済み)なら、理由を区別せず404にする。
export const metadata: Metadata = {
  title: "学びのポートフォリオ",
  robots: { index: false, follow: false },
};

export default async function SharedPortfolioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const link = await resolveShareLink(admin, token);
  if (!link) notFound();

  const portfolio = toSharedView(await loadPortfolio(admin, link.studentId));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-ink">{portfolio.learnerName}さんの学びのポートフォリオ</h1>
      <p className="mt-1 text-sm text-ink-muted">
        本人が見せると決めた記録だけを表示しています。{link.label ? `(${link.label})` : ""}
      </p>
      <ol className="mt-8 space-y-6">
        {portfolio.entries.map((entry) => (
          <li key={entry.submissionId} className="rounded-lg border border-line p-4">
            <p className="text-xs font-medium text-ink-faint">
              {new Date(entry.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} ・ {entry.courseTitle} ・ {entry.fiscalYear}年度
            </p>
            <div className="mt-3">
              <PortfolioEntryBody entry={entry} />
            </div>
            {entry.selfAssessment && (
              <p className="mt-3 border-t border-line pt-3 text-sm">
                <span className="text-ink-muted">本人の自己評価: </span>
                {entry.selfAssessment.rating && `${RATING_LABELS[entry.selfAssessment.rating]} `}
                {entry.selfAssessment.comment}
              </p>
            )}
          </li>
        ))}
        {portfolio.entries.length === 0 && <li className="text-sm text-ink-muted">公開されている記録はありません。</li>}
      </ol>
    </div>
  );
}
