import { studyModeLabel, toStudyMode } from "@/lib/courses/study-mode";

/** 学習モード(教科・科目学習モード/探究学習モード)の印。一覧やヘッダーで、いまのモードが分かるようにする。 */
export function StudyModeBadge({ kind }: { kind: unknown }) {
  const inquiry = toStudyMode(kind) === "inquiry";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${inquiry ? "bg-accent-soft text-accent" : "bg-surface text-ink-muted ring-1 ring-line"}`}
    >
      {studyModeLabel(kind)}
    </span>
  );
}
