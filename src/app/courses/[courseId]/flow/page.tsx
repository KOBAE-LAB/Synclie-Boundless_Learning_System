import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { readCheckQuestions, stepKindLabel } from "@/lib/flow/steps";
import { STEP_COLUMNS, toCourseStep } from "@/lib/flow/load";
import {
  addStepAction,
  deleteStepAction,
  generateCheckQuestionsAction,
  moveStepAction,
  saveCheckQuestionsAction,
  updateFlowSettingsAction,
  updateStepAction,
} from "./actions";

// 学習の流れ(インプットとアウトプットの設計)。動画・資料を見る時間(インプット)と、擬似メンバーとの
// 議論で深める時間(アウトプット)を、教師が授業ごとに自由に並べる。ステップが無い授業は従来どおり。

const input = "w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm";
const btn = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";
const primary = "rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50";

export default async function FlowPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();
  const admin = createAdminClient();

  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id, steps_in_order")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.owner_teacher_id !== user.id) notFound();

  const [{ data: stepRows }, { data: materialRows }] = await Promise.all([
    admin.from("course_steps").select(STEP_COLUMNS).eq("course_id", courseId).order("position", { ascending: true }),
    admin.from("course_materials").select("id, title, kind, rag_status").eq("course_id", courseId).order("created_at", { ascending: true }),
  ]);
  const steps = (stepRows ?? []).map(toCourseStep);
  const materials = materialRows ?? [];
  const totalMinutes = steps.reduce((sum, s) => sum + (s.minutes ?? 0), 0);

  const materialSelect = (name: string, defaultValue: string) => (
    <select name={name} defaultValue={defaultValue} className={input} aria-label={t("flowAdmin.materialAria")}>
      <option value="">{t("flowAdmin.noMaterial")}</option>
      {materials.map((m) => (
        <option key={m.id} value={m.id}>
          {m.title}({m.kind}{m.rag_status === "done" ? "" : t("flowAdmin.ragMissing")})
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("flowAdmin.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">{t("flowAdmin.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("flowAdmin.leadA")}<b>{t("flowAdmin.leadInput")}</b>{t("flowAdmin.leadMid")}<b>{t("flowAdmin.leadOutput")}</b>{t("flowAdmin.leadB")}
      </p>

      <form action={updateFlowSettingsAction.bind(null, courseId)} className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="stepsInOrder" defaultChecked={course.steps_in_order !== false} className="mt-1" />
          <span>
            {t("flowAdmin.inOrder")}
            <span className="block text-xs text-ink-muted">{t("flowAdmin.inOrderHelp")}</span>
          </span>
        </label>
        <SubmitButton className={btn} pendingText={t("flowAdmin.saving")}>{t("flowAdmin.save")}</SubmitButton>
      </form>

      <h2 className="mt-8 text-sm font-semibold text-ink">
        {t("flowAdmin.stepsHeading", { n: steps.length, total: totalMinutes > 0 ? t("flowAdmin.totalMinutes", { m: totalMinutes }) : "" })}
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => {
          const questions = readCheckQuestions(step.checkQuestions);
          return (
            <li key={step.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-sm font-medium text-ink">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${step.kind === "input" ? "bg-accent-soft text-accent" : "bg-success-soft text-success"}`}>
                    {i + 1}. {stepKindLabel(t, step.kind)}
                  </span>
                  {step.title}
                  {step.minutes ? <span className="ml-2 text-xs font-normal text-ink-muted">{t("flowAdmin.aboutMin", { m: step.minutes })}</span> : null}
                  {step.videoPath ? <span className="ml-2 text-xs font-normal text-ink-muted">{t("flowAdmin.hasVideo")}</span> : null}
                </p>
                <div className="flex flex-wrap gap-1">
                  <form action={moveStepAction.bind(null, courseId, step.id, "up")}>
                    <button type="submit" disabled={i === 0} className={btn} aria-label={t("flowAdmin.up")}>↑</button>
                  </form>
                  <form action={moveStepAction.bind(null, courseId, step.id, "down")}>
                    <button type="submit" disabled={i === steps.length - 1} className={btn} aria-label={t("flowAdmin.down")}>↓</button>
                  </form>
                  <form action={deleteStepAction.bind(null, courseId, step.id)}>
                    <button type="submit" className={`${btn} text-danger`}>{t("flowAdmin.delete")}</button>
                  </form>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-muted">{t("flowAdmin.editSummary")}</summary>
                <form action={updateStepAction.bind(null, courseId, step.id)} className="mt-3 space-y-2">
                  <label className="block text-xs text-ink-muted">
                    {t("flowAdmin.nameLabel")}
                    <input name="title" required maxLength={80} defaultValue={step.title} className={`mt-1 ${input}`} />
                  </label>
                  <label className="block text-xs text-ink-muted">
                    {t("flowAdmin.instruction")}
                    <textarea name="instruction" rows={2} maxLength={600} defaultValue={step.instruction} className={`mt-1 ${input}`} />
                  </label>
                  {step.kind === "input" && (
                    <>
                      <label className="block text-xs text-ink-muted">
                        {t("flowAdmin.videoUrl")}
                        <input name="videoUrl" defaultValue={step.videoUrl ?? ""} placeholder="https://www.youtube.com/watch?v=..." className={`mt-1 ${input}`} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        {t("flowAdmin.videoFile")}
                        <input name="videoFile" type="file" accept="video/mp4,video/webm" className={`mt-1 ${input}`} />
                      </label>
                      {step.videoPath && (
                        <label className="flex items-center gap-2 text-xs text-ink-muted">
                          <input type="checkbox" name="removeVideoFile" />
                          {t("flowAdmin.removeVideo")}
                        </label>
                      )}
                      <label className="block text-xs text-ink-muted">
                        {t("flowAdmin.materialInput")}
                        <span className="mt-1 block">{materialSelect("materialId", step.materialId ?? "")}</span>
                      </label>
                    </>
                  )}
                  <label className="block text-xs text-ink-muted">
                    {t("flowAdmin.minutesLabel")}
                    <input name="minutes" type="number" min={1} max={240} defaultValue={step.minutes ?? ""} className={`mt-1 w-28 ${input}`} />
                  </label>
                  <SubmitButton className={primary} pendingText={t("flowAdmin.saving")}>{t("flowAdmin.save")}</SubmitButton>
                </form>
              </details>

              {step.kind === "input" && (
                <details className="mt-3" open={questions.length > 0}>
                  <summary className="cursor-pointer text-xs text-ink-muted">{t("flowAdmin.checkSummary", { n: questions.length })}</summary>
                  <p className="mt-2 text-xs text-ink-faint">
                    {t("flowAdmin.checkLead")}
                  </p>
                  <form action={generateCheckQuestionsAction.bind(null, courseId, step.id)} className="mt-2">
                    <SubmitButton className={btn} pendingText={t("flowAdmin.creating")}>
                      {questions.length > 0 ? t("flowAdmin.remake") : t("flowAdmin.makeQ")}
                    </SubmitButton>
                  </form>
                  <form action={saveCheckQuestionsAction.bind(null, courseId, step.id)} className="mt-3 space-y-3">
                    {Array.from({ length: Math.max(questions.length, 1) + (questions.length < 6 ? 1 : 0) }, (_, qi) => {
                      const q = questions[qi];
                      return (
                        <div key={qi} className="space-y-1 rounded-md border border-line p-3">
                          <input name={`question-${qi}`} defaultValue={q?.question ?? ""} placeholder={t("flowAdmin.qN", { n: qi + 1 })} aria-label={t("flowAdmin.qN", { n: qi + 1 })} className={input} />
                          <input name={`answerPoints-${qi}`} defaultValue={q?.answerPoints ?? ""} placeholder={t("flowAdmin.answerGuide")} aria-label={t("flowAdmin.answerGuideAria", { n: qi + 1 })} className={input} />
                          <input name={`evidence-${qi}`} defaultValue={q?.evidence ?? ""} placeholder={t("flowAdmin.evidence")} aria-label={t("flowAdmin.evidenceAria", { n: qi + 1 })} className={input} />
                        </div>
                      );
                    })}
                    <SubmitButton className={btn} pendingText={t("flowAdmin.saving")}>{t("flowAdmin.saveQ")}</SubmitButton>
                  </form>
                </details>
              )}
            </li>
          );
        })}
        {steps.length === 0 && <li className="text-sm text-ink-muted">{t("flowAdmin.noSteps")}</li>}
      </ol>

      <form action={addStepAction.bind(null, courseId)} className="mt-6 space-y-3 rounded-lg border border-line p-4">
        <h2 className="text-sm font-semibold text-ink">{t("flowAdmin.addHeading")}</h2>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">{t("flowAdmin.kindLegend")}</legend>
          <label className="flex items-center gap-1"><input type="radio" name="kind" value="input" defaultChecked />{t("flowAdmin.kindInput")}</label>
          <label className="flex items-center gap-1"><input type="radio" name="kind" value="output" />{t("flowAdmin.kindOutput")}</label>
        </fieldset>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.nameLabel")}
          <input name="title" required maxLength={80} placeholder={t("flowAdmin.namePlaceholder")} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.instructionOpt")}
          <textarea name="instruction" rows={2} maxLength={600} placeholder={t("flowAdmin.instructionPlaceholder")} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.videoUrlInput")}
          <input name="videoUrl" placeholder="https://www.youtube.com/watch?v=..." className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.videoFileInput")}
          <input name="videoFile" type="file" accept="video/mp4,video/webm" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.materialOnly")}
          <span className="mt-1 block">{materialSelect("materialId", "")}</span>
        </label>
        <label className="block text-xs text-ink-muted">
          {t("flowAdmin.minutesLabel")}
          <input name="minutes" type="number" min={1} max={240} className={`mt-1 w-28 ${input}`} />
        </label>
        <SubmitButton className={primary} pendingText={t("flowAdmin.adding")}>{t("flowAdmin.add")}</SubmitButton>
      </form>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
