// ペルソナの「考え方の深さ」と「返答のテンポ」。personas.behavior_rules(jsonb)に文字列で保存する
// (列の追加は不要。未設定の既存ペルソナは、どちらも「標準」「ふつう」として扱う)。

export const THINKING_DEPTHS = ["直感的", "標準", "じっくり論理的"] as const;
export type ThinkingDepth = (typeof THINKING_DEPTHS)[number];

export const REPLY_TEMPOS = ["すばやい", "ふつう", "ゆっくり"] as const;
export type ReplyTempo = (typeof REPLY_TEMPOS)[number];

export function normalizeThinkingDepth(value: unknown): ThinkingDepth {
  return (THINKING_DEPTHS as readonly unknown[]).includes(value) ? (value as ThinkingDepth) : "標準";
}

export function normalizeReplyTempo(value: unknown): ReplyTempo {
  return (REPLY_TEMPOS as readonly unknown[]).includes(value) ? (value as ReplyTempo) : "ふつう";
}

/** 擬似メンバーへの指示(プロンプト)。AIの素の性能は変えず、「その人らしい考え方・話し方」を決める。 */
export const THINKING_DEPTH_GUIDANCE: Record<ThinkingDepth, string> = {
  直感的:
    "直感的に考えるタイプ。印象・経験・気持ちから、短く(1〜2文)素早く反応する。細かい根拠の検討は、学習者や他のメンバーに任せてよい。",
  標準: "ふつうの深さで考える。根拠を一つ示しながら、2〜3文で話す。",
  じっくり論理的:
    "じっくり論理的に考えるタイプ。前提・根拠・反例を分けて考え、筋道を立てて話す(2〜4文)。結論を急がず、確かめるべき点を具体的に挙げる。",
};

// ---- 返答のテンポ(画面での出方) ----
// 実際のAIの生成速度を変えるものではなく、返答を画面に出す「間」と文字の出る速さを、
// ペルソナの個性に合わせる(即答タイプ、考え込むタイプ)。生成が間に合っていない間は、
// 生成された分までしか表示できない。
export interface TempoParams {
  /** 返答が出る前の「入力中…」の間(ミリ秒) */
  preDelayMs: number;
  /** 文字が出る速さ(1秒あたりの文字数)。Infinity なら、届いた分をすぐ全部出す */
  charsPerSec: number;
}

export const TEMPO_PARAMS: Record<ReplyTempo, TempoParams> = {
  すばやい: { preDelayMs: 0, charsPerSec: Number.POSITIVE_INFINITY },
  ふつう: { preDelayMs: 500, charsPerSec: 80 },
  ゆっくり: { preDelayMs: 1500, charsPerSec: 30 },
};

export interface PacedMessage {
  text: string;
  tempo: ReplyTempo;
}

export interface PacingState {
  /** メッセージごとに、いま画面に出す文字数 */
  shown: number[];
  /** 「入力中…」を出すべきメッセージの番号(無ければ null) */
  typingIndex: number | null;
  /** 届いているメッセージが、すべて最後まで出し終えたか */
  finished: boolean;
}

/**
 * 経過時間(最初のメッセージが届いてから)と、いま届いているメッセージから、画面に出す内容を決める。
 * メッセージは順番に出す(前の発言を出し終えてから、次の人の「入力中…」が始まる)。
 */
export function computePacing(messages: PacedMessage[], elapsedMs: number): PacingState {
  const shown: number[] = [];
  let typingIndex: number | null = null;
  let cursor = 0; // ここまでに使った時間
  let finished = true;

  for (let i = 0; i < messages.length; i++) {
    const { preDelayMs, charsPerSec } = TEMPO_PARAMS[messages[i].tempo];
    const length = messages[i].text.length;
    const start = cursor;
    const typingEnd = start + preDelayMs;
    const revealMs = Number.isFinite(charsPerSec) ? (length / charsPerSec) * 1000 : 0;
    const end = typingEnd + revealMs;

    if (elapsedMs < start) {
      shown.push(0); // まだ順番が来ていない
      finished = false;
    } else if (elapsedMs < typingEnd) {
      shown.push(0);
      typingIndex = i;
      finished = false;
    } else if (elapsedMs < end) {
      shown.push(Math.min(length, Math.floor(((elapsedMs - typingEnd) / 1000) * charsPerSec)));
      finished = false;
    } else {
      shown.push(length);
    }
    cursor = end;
  }
  return { shown, typingIndex, finished };
}
