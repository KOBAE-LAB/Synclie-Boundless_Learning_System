// 自己評価・教師評価の入力チェックと、評価の段階の定義(DBに触れない純粋な関数)。
// AIの評価(F20/F24)は材料にとどめ、最終判断は学習者本人と教師に残す(非機能要件)。

export const RATING_LABELS: Record<number, string> = {
  4: "よくできた",
  3: "できた",
  2: "もう少し",
  1: "これから",
};

export const MAX_COMMENT_LENGTH = 1000;

export interface Assessment {
  rating: number | null;
  comment: string;
  updatedAt: string;
}

/** フォームの入力を、保存してよい形に整える。段階もコメントも空なら null(=評価を消す)。 */
export function parseAssessmentInput(input: { rating: string; comment: string }, now: Date = new Date()): Assessment | null {
  const parsed = Number.parseInt(input.rating, 10);
  const rating = Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : null;
  const comment = input.comment.trim().slice(0, MAX_COMMENT_LENGTH);
  if (rating === null && comment === "") return null;
  return { rating, comment, updatedAt: now.toISOString() };
}

/** DBのjsonbから読んだ値を、安全に Assessment に直す(壊れた値は null)。 */
export function readAssessment(value: unknown): Assessment | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const rating = typeof v.rating === "number" && v.rating >= 1 && v.rating <= 4 ? v.rating : null;
  const comment = typeof v.comment === "string" ? v.comment : "";
  if (rating === null && comment === "") return null;
  return { rating, comment, updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "" };
}

/** 日本の年度(4月始まり)。ポートフォリオを年度ごとに分けるために使う。日本時間で数える。 */
export function fiscalYearOf(isoDate: string): number {
  const jst = new Date(new Date(isoDate).getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  return month >= 4 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
}
