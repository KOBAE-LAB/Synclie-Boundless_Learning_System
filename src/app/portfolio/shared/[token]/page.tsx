import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { PortfolioEntryBody } from "@/components/portfolio-entry-body";
import { loadPortfolio, toSharedView } from "@/lib/portfolio/load";
import { ratingLabel } from "@/lib/portfolio/assessment";
import { formatDateJst, getT } from "@/lib/i18n/server";
import { resolveShareLink } from "@/lib/portfolio/share";

// 学習者本人が作った公開リンクの閲覧ページ(ログイン不要)。本人が「公開用」にした成果だけを見せる。
// 検索に載せない。リンクが無効(存在しない・期限切れ・取り消し済み)なら、理由を区別せず404にする。
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("portfolioShared.metaTitle"), robots: { index: false, follow: false } };
}

export default async function SharedPortfolioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t, lang } = await getT();
  const admin = createAdminClient();
  const link = await resolveShareLink(admin, token);
  if (!link) notFound();

  const portfolio = toSharedView(await loadPortfolio(admin, link.studentId, { lang }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-ink">{t("portfolioShared.heading", { name: portfolio.learnerName })}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("portfolioShared.lead", { label: link.label ? `(${link.label})` : "" })}
      </p>
      <ol className="mt-8 space-y-6">
        {portfolio.entries.map((entry) => (
          <li key={entry.submissionId} className="rounded-lg border border-line p-4">
            <p className="text-xs font-medium text-ink-faint">
              {t("portfolio.entryMeta", { date: formatDateJst(entry.createdAt, lang), course: entry.courseTitle, year: entry.fiscalYear })}
            </p>
            <div className="mt-3">
              <PortfolioEntryBody entry={entry} />
            </div>
            {entry.selfAssessment && (
              <p className="mt-3 border-t border-line-soft pt-3 text-sm">
                <span className="text-ink-muted">{t("portfolioShared.selfAssessment")}</span>
                {entry.selfAssessment.rating && `${ratingLabel(t, entry.selfAssessment.rating)} `}
                {entry.selfAssessment.comment}
              </p>
            )}
          </li>
        ))}
        {portfolio.entries.length === 0 && <li className="text-sm text-ink-muted">{t("portfolioShared.empty")}</li>}
      </ol>
    </div>
  );
}
