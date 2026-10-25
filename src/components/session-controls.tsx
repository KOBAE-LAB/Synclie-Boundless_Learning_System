"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock, statusFromElapsed } from "@/lib/learn/session-end";
import { useT } from "@/lib/i18n/client";

/**
 * 学習(議論)の終わりに関する、学習者の画面の部品。
 *  - 制限時間があれば、残り時間(超過したら超過時間)をカウントダウン表示する
 *  - AIが「そろそろまとめましょう」と提案している時(または時間を過ぎた時)に、
 *    「まとめに進む」「もう少し続ける」を出す
 *  - 教師の設定が「超過したら発言を止める」で時間を過ぎたら、自動的に議論を終えてまとめを作る
 *
 * 時間の判定は、サーバーの時刻を基準にした画面上の表示。実際に発言を止める判断は、
 * サーバー側(lib/learn/dialogue.ts)が毎回行うため、画面の時計がずれても抜け道にはならない。
 * クライアントJSが必要な5つ目の理由(カウントダウンと、時間切れの検知のため)。
 */
export function SessionControls({
  courseId,
  elapsedMsAtRender,
  limitMinutes,
  policy,
  affectsEvaluation,
  ended,
  suggestionReason,
  dismissAction,
}: {
  courseId: string;
  // サーバーが画面を作った時点での、最初の発言からの経過時間(ミリ秒)。まだ始まっていなければ null。
  // 端末の時計ではなくサーバーが数えた値を基準にするので、端末の時計がずれていても正しく表示できる。
  elapsedMsAtRender: number | null;
  limitMinutes: number | null;
  policy: string;
  affectsEvaluation: boolean;
  ended: boolean;
  suggestionReason: string | null; // AIが提案している理由(提案が無ければ null)
  dismissAction: () => Promise<void>;
}) {
  const router = useRouter();
  const t = useT();
  const [extraMs, setExtraMs] = useState(0); // 画面を開いてから経った時間
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoClosedRef = useRef(false);

  useEffect(() => {
    const openedAt = Date.now();
    const timer = setInterval(() => setExtraMs(Date.now() - openedAt), 1000);
    return () => clearInterval(timer);
  }, [elapsedMsAtRender]);

  const startedAt = elapsedMsAtRender !== null;
  const status =
    elapsedMsAtRender !== null && limitMinutes
      ? statusFromElapsed(elapsedMsAtRender + extraMs, limitMinutes, policy)
      : null;

  async function closeNow() {
    if (closing) return;
    setClosing(true);
    setError(null);
    try {
      const response = await fetch(`/api/learn/${courseId}/close`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? t("session.closeFailedStatus", { status: response.status }));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("session.closeFailed"));
      setClosing(false);
      autoClosedRef.current = false;
    }
  }

  // 「超過したら発言を止める」設定で、時間を過ぎたら、自動的に議論を終えてまとめを作る。
  useEffect(() => {
    if (!ended && status?.blocksInput && !autoClosedRef.current) {
      autoClosedRef.current = true;
      void closeNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, status?.blocksInput]);

  if (!limitMinutes && !suggestionReason) return null;

  const showCloseButtons = !ended && !closing && (suggestionReason !== null || (status?.isOver ?? false));
  const reason =
    suggestionReason ?? (status?.isOver ? t("session.timeUp") : null);

  return (
    <div className="mt-4 space-y-3">
      {limitMinutes ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-4 py-2 text-sm ${
            status?.isOver ? "border-warn bg-warn-soft text-warn" : "border-line bg-surface text-ink-muted"
          }`}
          role="timer"
          aria-live="off"
        >
          <span>
            {t("session.limit", { n: limitMinutes })}
            {policy === "hard" ? t("session.hard") : t("session.soft")}
            {affectsEvaluation && t("session.affects")}
          </span>
          <span className="font-mono text-base tabular-nums">
            {ended
              ? t("session.ended")
              : !startedAt
                ? t("session.notStarted")
                : status?.isOver
                  ? t("session.over", { time: formatClock(status.overtimeMs) })
                  : t("session.remaining", { time: formatClock(status?.remainingMs ?? 0) })}
          </span>
        </div>
      ) : null}

      {closing && !ended && (
        <p className="flex items-center gap-1.5 text-sm text-ink-muted" role="status">
          {t("session.summarizing")}
          <span className="flex items-center gap-0.5" aria-hidden="true">
            <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
            <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
            <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
          </span>
        </p>
      )}

      {showCloseButtons && reason && (
        <div className="rounded-md border border-accent bg-accent-soft px-4 py-3 text-sm text-accent" role="status">
          <p className="font-medium">{t("session.aiSuggests")}</p>
          <p className="mt-1">{reason}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void closeNow()}
              className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
            >
              {t("session.goSummary")}
            </button>
            {status?.blocksInput ? null : (
              <button
                type="button"
                onClick={async () => {
                  await dismissAction();
                  router.refresh();
                }}
                className="rounded-md border border-accent px-3 py-1.5 text-xs font-medium hover:bg-surface"
              >
                {t("session.keepGoing")}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {t("session.summaryNote")}
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
