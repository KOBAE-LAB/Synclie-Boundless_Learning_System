// 授業回の状態: 準備中 → 公開中 → 終了(2026-10-23)。教科・科目が終了(アーカイブ)していれば、公開済みの授業回はすべて終了として扱う。
//  - 準備中: 学習者には見えない / 公開中: 履修している学習者が開ける / 終了: 見返すだけ(新しい発言・提出・インプットの完了はできない)。
export type LessonStatus = "preparing" | "open" | "closed";

export const LESSON_STATUS_LABELS: Record<LessonStatus, string> = {
  preparing: "準備中",
  open: "公開中",
  closed: "終了",
};

/** 状態ごとの印の色(文字と下地。色だけに頼らず、必ず文字のラベルと一緒に出す)。 */
export const LESSON_STATUS_CLASSES: Record<LessonStatus, string> = {
  preparing: "bg-warn-soft text-warn",
  open: "bg-success-soft text-success",
  closed: "bg-surface text-ink-muted ring-1 ring-line",
};

export function lessonStatus(lesson: { released: boolean; closed_at: string | null }, seriesEnded: boolean): LessonStatus {
  if (lesson.closed_at) return "closed";
  if (!lesson.released) return "preparing";
  return seriesEnded ? "closed" : "open";
}
