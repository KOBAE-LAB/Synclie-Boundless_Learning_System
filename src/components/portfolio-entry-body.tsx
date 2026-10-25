import { ratingLabel } from "@/lib/portfolio/assessment";
import { getT } from "@/lib/i18n/server";
import type { PortfolioEntry } from "@/lib/portfolio/types";

// ポートフォリオ1件の読み取り用の表示(本人の画面と、公開ページで共用)。
// 公開ページでは toSharedView() で振り返り・AI評価を外してから渡す。
export async function PortfolioEntryBody({ entry }: { entry: PortfolioEntry }) {
  const { t } = await getT();
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-medium text-ink-muted">{t("portfolioEntry.work")}</p>
        <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
      </div>

      {entry.discussion && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">{t("portfolioEntry.discussionSummary")}</p>
          <p className="mt-1 whitespace-pre-wrap">{entry.discussion.summary}</p>
          {entry.discussion.keyPoints.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {entry.discussion.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entry.teacherAssessment && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">
            {t("portfolioEntry.teacherComment")}
            {entry.teacherAssessment.rating && `(${ratingLabel(t, entry.teacherAssessment.rating)})`}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{entry.teacherAssessment.comment}</p>
        </div>
      )}

      {(entry.feedback.length > 0 || entry.judgment) && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">{t("portfolioEntry.aiFeedback")}</p>
          <p className="text-xs text-ink-faint">{t("portfolioEntry.aiNote")}</p>
          {entry.feedback.map((f, i) => (
            <div key={i} className="mt-2">
              <p className="text-xs font-medium text-ink-muted">{f.criteriaLabel}</p>
              <p>
                <span className="text-ink-muted">{t("portfolioEntry.goodPoints")}</span>
                {f.goodPoints}
              </p>
              <p>
                <span className="text-ink-muted">{t("portfolioEntry.nextQuestion")}</span>
                {f.nextQuestion}
              </p>
            </div>
          ))}
          {entry.judgment && (
            <p className="mt-2">
              <span className="text-ink-muted">{t("portfolioEntry.discussionEval")}</span>
              {t("portfolioEntry.judgment", { logic: entry.judgment.logicStructure, evidence: entry.judgment.evidenceQuality, rebuttal: entry.judgment.rebuttalResponse, summary: entry.judgment.summaryComment })}
            </p>
          )}
        </div>
      )}

      {entry.reflection && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">{t("portfolioEntry.reflection")}</p>
          <p>
            <span className="text-ink-muted">{t("portfolioEntry.learned")}</span>
            {entry.reflection.whatLearned}
          </p>
          <p>
            <span className="text-ink-muted">{t("portfolioEntry.confused")}</span>
            {entry.reflection.whatConfused}
          </p>
          <p>
            <span className="text-ink-muted">{t("portfolioEntry.nextGoal")}</span>
            {entry.reflection.nextGoal}
          </p>
        </div>
      )}
    </div>
  );
}
