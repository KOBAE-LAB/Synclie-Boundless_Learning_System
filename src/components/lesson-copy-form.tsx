import { SubmitButton } from "@/components/submit-button";
import { getT } from "@/lib/i18n/server";
import { lessonName, type SiblingLessons } from "@/lib/courses/series";

// 「別の授業回から複製する」フォーム(擬似メンバー・評価の観点で共用)。
export async function LessonCopyForm({
  lessons,
  action,
  title,
  description,
  copied,
  skipped,
}: {
  lessons: SiblingLessons;
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  description: string;
  copied?: string;
  skipped?: string;
}) {
  if (lessons.siblings.length === 0) return null;
  const { t, lang } = await getT();
  const copiedN = copied === undefined ? null : Number.parseInt(copied, 10);
  const skippedN = skipped === undefined ? 0 : Number.parseInt(skipped, 10) || 0;
  return (
    <section className="mt-6 rounded-lg border border-line p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <p className="mt-1 text-xs text-ink-muted">{description}</p>
      {copiedN !== null && Number.isInteger(copiedN) && (
        <p className="mt-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success">
          {copiedN === 0 && skippedN > 0
            ? t("lessonCopy.nothingCopied", { n: skippedN })
            : t("lessonCopy.copied", { n: copiedN, skipped: skippedN > 0 ? t("lessonCopy.copiedSkipped", { n: skippedN }) : "" })}
        </p>
      )}
      <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="copy-from" className="sr-only">{t("lessonCopy.sourceLabel")}</label>
        <select
          id="copy-from"
          name="fromCourseId"
          defaultValue={lessons.defaultFromId ?? ""}
          className="min-w-0 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm"
        >
          {lessons.siblings.map((s) => (
            <option key={s.id} value={s.id}>{lessonName(s.lessonNo, s.title, lang)}</option>
          ))}
        </select>
        <SubmitButton pendingText={t("lessonCopy.copying")} className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
          {t("lessonCopy.copyFrom")}
        </SubmitButton>
      </form>
    </section>
  );
}
