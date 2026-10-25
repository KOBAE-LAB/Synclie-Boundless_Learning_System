import { getT } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { createCriterionAction, deleteCriterionAction } from "./actions";
import { loadLessonCrumbs, loadSiblingLessons } from "@/lib/courses/series";
import { LessonCopyForm } from "@/components/lesson-copy-form";
import { copyCriteriaFromLessonAction } from "../lesson-copy-actions";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

interface CriterionRow {
  id: string;
  label: string;
  description: string | null;
}

export default async function EvaluationCriteriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ copied?: string; skipped?: string }>;
}) {
  const { courseId } = await params;
  const { copied: copiedParam, skipped: skippedParam } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { data: criteria } = await admin
    .from("evaluation_criteria")
    .select("id, label, description")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

  const siblingLessons = await loadSiblingLessons(admin, courseId);
  const boundCreateAction = createCriterionAction.bind(null, courseId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("criteria.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("criteria.title")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("criteria.lead")}
      </p>

      <LessonCopyForm
        lessons={siblingLessons}
        action={copyCriteriaFromLessonAction.bind(null, courseId)}
        title={t("criteria.copyTitle")}
        description={t("criteria.copyDesc")}
        copied={copiedParam}
        skipped={skippedParam}
      />

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="mb-4 text-sm font-medium text-ink">
          {t("criteria.addHeading")}
        </h2>
        <form action={boundCreateAction} className="space-y-3">
          <label htmlFor="criteria-label" className="sr-only">
            {t("criteria.nameLabel")}
          </label>
          <input
            id="criteria-label"
            name="label"
            placeholder={t("criteria.namePlaceholder")}
            required
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <label htmlFor="criteria-description" className="sr-only">
            {t("criteria.descLabel")}
          </label>
          <textarea
            id="criteria-description"
            name="description"
            placeholder={t("criteria.descPlaceholder")}
            rows={2}
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <button
            type="submit"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            {t("criteria.add")}
          </button>
        </form>
      </div>

      <ul className="mt-8 space-y-2">
        {((criteria ?? []) as CriterionRow[]).map((criterion) => {
          const boundDeleteAction = deleteCriterionAction.bind(null, courseId, criterion.id);
          return (
            <li
              key={criterion.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-sm"
            >
              <Link
                href={`/courses/${courseId}/criteria/${criterion.id}`}
                className="min-w-0 hover:underline"
              >
                <span className="font-medium text-ink">{criterion.label}</span>
                {criterion.description && (
                  <span className="ml-2 text-ink-muted">{criterion.description}</span>
                )}
              </Link>
              <form action={boundDeleteAction}>
                <button
                  type="submit"
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                >
                  {t("criteria.delete")}
                </button>
              </form>
            </li>
          );
        })}
        {(!criteria || criteria.length === 0) && (
          <li className="text-sm text-ink-muted">
            {t("criteria.none")}
          </li>
        )}
      </ul>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
