import { RATING_LABELS } from "@/lib/portfolio/assessment";
import { AI_NOTE } from "@/lib/portfolio/render";
import type { PortfolioEntry } from "@/lib/portfolio/types";

// ポートフォリオ1件の読み取り用の表示(本人の画面と、公開ページで共用)。
// 公開ページでは toSharedView() で振り返り・AI評価を外してから渡す。
export function PortfolioEntryBody({ entry }: { entry: PortfolioEntry }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-medium text-ink-muted">成果</p>
        <p className="mt-1 whitespace-pre-wrap">{entry.content}</p>
      </div>

      {entry.discussion && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">議論のまとめ</p>
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
            教師のコメント
            {entry.teacherAssessment.rating && `(${RATING_LABELS[entry.teacherAssessment.rating]})`}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{entry.teacherAssessment.comment}</p>
        </div>
      )}

      {(entry.feedback.length > 0 || entry.judgment) && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">AIフィードバック</p>
          <p className="text-xs text-ink-faint">{AI_NOTE}</p>
          {entry.feedback.map((f, i) => (
            <div key={i} className="mt-2">
              <p className="text-xs font-medium text-ink-muted">{f.criteriaLabel}</p>
              <p>
                <span className="text-ink-muted">良い点: </span>
                {f.goodPoints}
              </p>
              <p>
                <span className="text-ink-muted">次に考える問い: </span>
                {f.nextQuestion}
              </p>
            </div>
          ))}
          {entry.judgment && (
            <p className="mt-2">
              <span className="text-ink-muted">議論の評価: </span>
              論理構成 {entry.judgment.logicStructure}/5・根拠の質 {entry.judgment.evidenceQuality}/5・反論への応答{" "}
              {entry.judgment.rebuttalResponse}/5 — {entry.judgment.summaryComment}
            </p>
          )}
        </div>
      )}

      {entry.reflection && (
        <div className="border-t border-line-soft pt-3">
          <p className="text-xs font-medium text-ink-muted">振り返り</p>
          <p>
            <span className="text-ink-muted">学んだこと: </span>
            {entry.reflection.whatLearned}
          </p>
          <p>
            <span className="text-ink-muted">迷ったこと: </span>
            {entry.reflection.whatConfused}
          </p>
          <p>
            <span className="text-ink-muted">次にやりたいこと: </span>
            {entry.reflection.nextGoal}
          </p>
        </div>
      )}
    </div>
  );
}
