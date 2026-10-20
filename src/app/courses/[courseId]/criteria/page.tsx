import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { createCriterionAction, deleteCriterionAction } from "./actions";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

interface CriterionRow {
  id: string;
  label: string;
  description: string | null;
}

export default async function EvaluationCriteriaPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
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

  const { data: criteria } = await admin
    .from("evaluation_criteria")
    .select("id, label, description")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

  const boundCreateAction = createCriterionAction.bind(null, courseId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/courses" }, { label: course.title, href: `/courses/${courseId}` }]} current="評価の観点" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        評価の観点(F07)
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        学習者の提出物(F06)に対するAIフィードバックの観点を設定する。
        例: 根拠の明確さ、多面的な見方、資料の活用。点数ではなく、観点ごとの助言を返す。
      </p>

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="mb-4 text-sm font-medium text-ink">
          新しい観点を追加
        </h2>
        <form action={boundCreateAction} className="space-y-3">
          <label htmlFor="criteria-label" className="sr-only">
            観点の名前
          </label>
          <input
            id="criteria-label"
            name="label"
            placeholder="観点の名前(例: 根拠の明確さ)"
            required
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <label htmlFor="criteria-description" className="sr-only">
            説明
          </label>
          <textarea
            id="criteria-description"
            name="description"
            placeholder="説明(任意。例: 主張を裏付ける事実や資料が示されているか)"
            rows={2}
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <button
            type="submit"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            追加する
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
                  削除
                </button>
              </form>
            </li>
          );
        })}
        {(!criteria || criteria.length === 0) && (
          <li className="text-sm text-ink-muted">
            まだ観点がありません。上のフォームから追加してください。観点が無いと学習者はAIフィードバックを受け取れません。
          </li>
        )}
      </ul>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
