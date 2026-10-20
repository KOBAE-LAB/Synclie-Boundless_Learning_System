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
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId))?.teacherTrail ?? []), { label: "評価の観点", href: `/courses/${courseId}/criteria` }]} current={criterion.label} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {criterion.label} を編集
      </h1>

      <form
        action={boundUpdateAction}
        className="mt-8 space-y-3 rounded-lg border border-line p-5"
      >
        <label htmlFor="criteria-label" className="sr-only">
          観点の名前
        </label>
        <input
          id="criteria-label"
          name="label"
          placeholder="観点の名前(例: 根拠の明確さ)"
          required
          defaultValue={criterion.label}
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <label htmlFor="criteria-description" className="sr-only">
          説明
        </label>
        <textarea
          id="criteria-description"
          name="description"
          placeholder="説明(任意)"
          rows={2}
          defaultValue={criterion.description ?? ""}
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          更新する
        </button>
      </form>
    </div>
  );
}
