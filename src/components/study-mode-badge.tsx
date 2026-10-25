import { toStudyMode } from "@/lib/courses/study-mode";
import { getT } from "@/lib/i18n/server";

/** 学習モード(教科・科目学習モード/探究学習モード)の印。一覧やヘッダーで、いまのモードが分かるようにする。 */
export async function StudyModeBadge({ kind }: { kind: unknown }) {
  const { t } = await getT();
  const mode = toStudyMode(kind);
  const inquiry = mode === "inquiry";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${inquiry ? "bg-accent-soft text-accent" : "bg-surface text-ink-muted ring-1 ring-line"}`}
    >
      {t(`studyMode.${mode}`)}
    </span>
  );
}
