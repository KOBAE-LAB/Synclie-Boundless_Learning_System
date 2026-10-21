// 探究の段階(要件定義書14章ステップ2の決定)。既定は学習指導要領の4段階。
// プロジェクトが独自の段階(inquiry_projects.stage_set)を持つ場合も、canonical で既定の4段階に対応づけるので、
// 当時モードの絞り込み(「この段階まで」)は、いつも既定の4段階の順序で比べる。
export const CANONICAL_STAGES = [
  { key: "problem_setting", label: "課題の設定" },
  { key: "information_gathering", label: "情報の収集" },
  { key: "analysis", label: "整理・分析" },
  { key: "expression", label: "まとめ・表現" },
] as const;

export type StageKey = (typeof CANONICAL_STAGES)[number]["key"];

export const FIRST_STAGE: StageKey = "problem_setting";

export function isStageKey(value: unknown): value is StageKey {
  return typeof value === "string" && CANONICAL_STAGES.some((s) => s.key === value);
}

export function stageLabel(key: string | null | undefined): string {
  return CANONICAL_STAGES.find((s) => s.key === key)?.label ?? "(段階は未設定)";
}

/** 既定の4段階の中での順番(0〜3)。知らない鍵は -1。 */
export function stageIndex(key: string | null | undefined): number {
  return CANONICAL_STAGES.findIndex((s) => s.key === key);
}

/** 当時モードの検索範囲: その段階までの段階の鍵(その段階を含む)。段階が無ければ最初の段階だけ。 */
export function stagesUpTo(key: string | null | undefined): StageKey[] {
  const i = stageIndex(key);
  return CANONICAL_STAGES.slice(0, Math.max(0, i) + 1).map((s) => s.key);
}

/**
 * 授業回の「想定の段階」に合わせて、プロジェクトの段階を進めるべきか。
 * 想定の段階がいまより先のときだけ進める(戻すことはしない。戻すのは学習者・教師が明示的に行う。探究はらせん状に戻ることもあるため)。
 */
export function shouldAdvanceToExpected(current: string | null | undefined, expected: string | null | undefined): boolean {
  if (!isStageKey(expected)) return false;
  if (!isStageKey(current)) return true;
  return stageIndex(expected) > stageIndex(current);
}
