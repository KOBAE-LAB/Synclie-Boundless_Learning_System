// 学習(議論)の終わりに関する、DBに触れない純粋な判定。"use server"ファイルからも、
// クライアントの残り時間表示からも使える(テストもしやすい)。

export type TimeLimitPolicy = "soft" | "hard";

export interface TimeStatus {
  /** 最初の発言からの経過時間(ミリ秒) */
  elapsedMs: number;
  /** 制限時間が設定されているか */
  hasLimit: boolean;
  /** 残り時間(ミリ秒)。超過していれば0 */
  remainingMs: number;
  /** 超過した時間(ミリ秒)。超過していなければ0 */
  overtimeMs: number;
  /** 制限時間を過ぎているか */
  isOver: boolean;
  /** 超過により、発言を止めるべきか(policy=hard で超過した時だけ true) */
  blocksInput: boolean;
}

/** 経過時間(ミリ秒)から、残り・超過・発言を止めるべきかを求める(画面の時計も、これを使う)。 */
export function statusFromElapsed(
  elapsedMs: number,
  limitMinutes: number | null | undefined,
  policy: TimeLimitPolicy | string | null | undefined,
): TimeStatus {
  if (!limitMinutes || limitMinutes <= 0) {
    return { elapsedMs, hasLimit: false, remainingMs: 0, overtimeMs: 0, isOver: false, blocksInput: false };
  }
  const limitMs = limitMinutes * 60 * 1000;
  const isOver = elapsedMs >= limitMs;
  return {
    elapsedMs,
    hasLimit: true,
    remainingMs: isOver ? 0 : limitMs - elapsedMs,
    overtimeMs: isOver ? elapsedMs - limitMs : 0,
    isOver,
    blocksInput: isOver && policy === "hard",
  };
}

export function getTimeStatus(params: {
  startedAt: string | Date;
  limitMinutes: number | null | undefined;
  policy: TimeLimitPolicy | string | null | undefined;
  now?: Date;
}): TimeStatus {
  const now = params.now ?? new Date();
  const elapsedMs = now.getTime() - new Date(params.startedAt).getTime();
  return statusFromElapsed(elapsedMs, params.limitMinutes, params.policy);
}

/** 「3:05」「12:00」のような分:秒の表記(残り時間・超過時間の表示用)。 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// AIによる「議論の状態」の判定は、AI呼び出しの費用がかかるため、毎回は行わない。
// 一定の発言数(suggestAfterTurn)に達してから、そこから2発言おきに行う。
export const MIN_TURNS_BEFORE_JUDGING = 4;
export const JUDGE_EVERY_N_TURNS = 2;
export const COOLDOWN_AFTER_DISMISS_TURNS = 4;

export function shouldJudgeDiscussionState(params: {
  studentTurnCount: number;
  suggestAfterTurn: number | null | undefined;
  aiCloseSuggestionEnabled: boolean;
  alreadySuggested: boolean;
  ended: boolean;
}): boolean {
  if (!params.aiCloseSuggestionEnabled || params.alreadySuggested || params.ended) return false;
  const threshold = Math.max(params.suggestAfterTurn ?? MIN_TURNS_BEFORE_JUDGING, MIN_TURNS_BEFORE_JUDGING);
  if (params.studentTurnCount < threshold) return false;
  return (params.studentTurnCount - threshold) % JUDGE_EVERY_N_TURNS === 0;
}
