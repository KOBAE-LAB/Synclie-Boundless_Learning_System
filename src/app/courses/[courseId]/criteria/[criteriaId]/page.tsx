import { getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { updateCriterionAction } from "../actions";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default async function EditCriterionPage({
  params,
}: {
  params: Promise<{ courseId: string; criteriaId: string }>;
}) {
  const { courseId, criteriaId } = await params;
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

  const { data: criterion } = await admin
    .from("evaluation_criteria")
    .select("id, course_id, label, description")
    .eq("id", criteriaId)
    .maybeSingle();
  if (!criterion || criterion.course_id !== courseId) {
    notFound();
  }

  const boundUpdateAction = updateCriterionAction.bind(null, courseId, criteriaId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? []), { label: t("criteria.title"), href: `/courses/${courseId}/criteria` }]} current={criterion.label} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("criteriaEdit.edit", { name: criterion.label })}
      </h1>

      <form
        action={boundUpdateAction}
        className="mt-8 space-y-3 rounded-lg border border-line p-5"
      >
        <label htmlFor="criteria-label" className="sr-only">
          {t("criteria.nameLabel")}
        </label>
        <input
          id="criteria-label"
          name="label"
          placeholder={t("criteria.namePlaceholder")}
          required
          defaultValue={criterion.label}
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <label htmlFor="criteria-description" className="sr-only">
          {t("criteria.descLabel")}
        </label>
        <textarea
          id="criteria-description"
          name="description"
          placeholder={t("criteriaEdit.descPlaceholder")}
          rows={2}
          defaultValue={criterion.description ?? ""}
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          {t("criteriaEdit.update")}
        </button>
      </form>
    </div>
  );
}
