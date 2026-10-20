import Link from "next/link";
import type { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import type { CourseStep, LearnerFlow } from "@/lib/flow/load";
import { currentStep, readCheckQuestions, STEP_KIND_LABELS } from "@/lib/flow/steps";
import { completeStepAction } from "./flow-actions";

type AdminClient = ReturnType<typeof createAdminClient>;

// 学習の流れ(インプット/アウトプット)の学習者向けの表示。サーバーコンポーネントだけで作る
// (動画の埋め込み・答えの目安の開閉は、ネイティブのHTML要素で足りる)。

/** 全ステップの進み具合。いまのステップと、見直せる終えたインプットはリンクにする。 */
export function FlowStepper({ courseId, flow, viewingId }: { courseId: string; flow: LearnerFlow; viewingId?: string | null }) {
  const current = currentStep(flow.steps, flow.doneIds);
  return (
    <nav aria-label="学習の流れ" className="mt-4 rounded-lg border border-line bg-surface p-3">
      <ol className="flex flex-wrap gap-2">
        {flow.steps.map((step, i) => {
          const done = flow.doneIds.has(step.id);
          const isCurrent = current?.id === step.id;
          const label = (
            <>
              <span aria-hidden="true">{done ? "✓" : i + 1}</span> {step.title}
              <span className="ml-1 text-[0.6875rem] opacity-70">{STEP_KIND_LABELS[step.kind]}</span>
            </>
          );
          const base = "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs";
          const state = isCurrent
            ? "border-accent bg-accent-soft font-medium text-accent"
            : done
              ? "border-line bg-surface-raised text-ink-muted"
              : "border-line text-ink-faint";
          const linkable = isCurrent || (done && step.kind === "input");
          return (
            <li key={step.id}>
              {linkable ? (
                <Link
                  href={isCurrent ? `/learn/${courseId}` : `/learn/${courseId}?step=${step.id}`}
                  aria-current={step.id === viewingId ? "step" : undefined}
                  className={`${base} ${state} hover:underline`}
                >
                  {label}
                </Link>
              ) : (
                <span className={`${base} ${state}`}>{label}</span>
              )}
            </li>
          );
        })}
      </ol>
      {!current && <p className="mt-2 text-xs text-ink-muted">すべてのステップを終えました。議論はこのまま続けられます。</p>}
    </nav>
  );
}

/** アウトプットのステップの案内(学習者への指示と、「このステップを終えて次へ」)。 */
export function OutputStepCard({ courseId, step, isCurrent }: { courseId: string; step: CourseStep; isCurrent: boolean }) {
  return (
    <section className="mt-3 rounded-lg border border-line p-4">
      <p className="text-xs font-medium text-success">アウトプット{step.minutes ? `・目安${step.minutes}分` : ""}</p>
      <h2 className="mt-1 text-base font-semibold text-ink">{step.title}</h2>
      {step.instruction && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{step.instruction}</p>}
      {isCurrent && (
        <form action={completeStepAction.bind(null, courseId, step.id)} className="mt-3">
          <SubmitButton
            pendingText="進んでいます…"
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            このステップを終えて次へ
          </SubmitButton>
        </form>
      )}
    </section>
  );
}

/** インプットのステップの画面(動画・資料・理解チェック)。 */
export async function InputStepView({
  admin,
  course,
  flow,
  step,
  studentId,
}: {
  admin: AdminClient;
  course: { id: string; title: string };
  flow: LearnerFlow;
  step: CourseStep;
  studentId: string;
}) {
  const courseId = course.id;
  const done = flow.doneIds.has(step.id);
  const questions = readCheckQuestions(step.checkQuestions);

  // 資料: PDFは署名つきURLで画面内に表示し、それ以外は取り込み済みの本文を表示する。
  let materialTitle: string | null = null;
  let pdfUrl: string | null = null;
  let sourceUrl: string | null = null;
  let bodyText: string | null = null;
  if (step.materialId) {
    const { data: material } = await admin
      .from("course_materials")
      .select("title, kind, storage_path, source_url, course_id")
      .eq("id", step.materialId)
      .maybeSingle();
    if (material && material.course_id === courseId) {
      materialTitle = material.title;
      sourceUrl = material.source_url;
      if (material.kind === "pdf" && material.storage_path) {
        const { data: signed } = await admin.storage.from("materials").createSignedUrl(material.storage_path, 3600);
        pdfUrl = signed?.signedUrl ?? null;
      }
      if (!pdfUrl) {
        const { data: chunks } = await admin
          .from("material_chunks")
          .select("content")
          .eq("material_id", step.materialId)
          .order("chunk_index", { ascending: true });
        bodyText = (chunks ?? []).map((c) => c.content).join("\n\n") || null;
      }
    }
  }

  let savedAnswers: { question: string; answer: string; selfCheck: string | null }[] = [];
  if (done) {
    const { data: progress } = await admin
      .from("step_progress")
      .select("answers")
      .eq("student_id", studentId)
      .eq("step_id", step.id)
      .maybeSingle();
    if (Array.isArray(progress?.answers)) savedAnswers = progress.answers as typeof savedAnswers;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current={course.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{course.title}</h1>
      <FlowStepper courseId={courseId} flow={flow} viewingId={step.id} />

      <section className="mt-4">
        <p className="text-xs font-medium text-accent">インプット{step.minutes ? `・目安${step.minutes}分` : ""}{done ? "・終えたステップ(見直し)" : ""}</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">{step.title}</h2>
        {step.instruction && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{step.instruction}</p>}
      </section>

      {step.videoUrl && (
        <section className="mt-4 rounded-lg border border-line p-4">
          <h3 className="text-sm font-medium text-ink">動画</h3>
          <a
            href={step.videoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-accent hover:bg-surface"
          >
            動画を新しいタブで開く <span aria-hidden="true">↗</span>
          </a>
          <p className="mt-2 break-all text-xs text-ink-faint">{step.videoUrl}</p>
          <p className="mt-1 text-xs text-ink-muted">見終わったら、このページに戻って続けましょう。</p>
        </section>
      )}

      {materialTitle && (
        <section className="mt-4 rounded-lg border border-line p-4">
          <h3 className="text-sm font-medium text-ink">資料: {materialTitle}</h3>
          {pdfUrl ? (
            <>
              <iframe src={pdfUrl} title={materialTitle} className="mt-3 h-[32rem] w-full rounded-md border border-line" />
              <a href={pdfUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-xs text-accent hover:underline">
                新しいタブで開く →
              </a>
            </>
          ) : bodyText ? (
            <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-md bg-surface p-3 text-sm leading-7">{bodyText}</div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">この資料はまだ表示できる形になっていません(先生が準備中です)。</p>
          )}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-xs text-accent hover:underline">
              元のページを開く →
            </a>
          )}
        </section>
      )}

      {done ? (
        <section className="mt-6 rounded-lg border border-line p-4">
          <p className="text-sm font-medium text-ink">このステップは終えています。</p>
          {savedAnswers.length > 0 && (
            <ul className="mt-3 space-y-3 text-sm">
              {savedAnswers.map((a, i) => (
                <li key={i}>
                  <p className="text-xs font-medium text-ink-muted">{a.question}</p>
                  <p className="mt-1 whitespace-pre-wrap">{a.answer}</p>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/learn/${courseId}`} className="mt-3 inline-block text-xs text-accent hover:underline">
            いまのステップに戻る →
          </Link>
        </section>
      ) : (
        <form action={completeStepAction.bind(null, courseId, step.id)} className="mt-6 space-y-4 rounded-lg border border-line p-4">
          {questions.length > 0 ? (
            <>
              <h3 className="text-sm font-semibold text-ink">理解チェック</h3>
              <p className="text-xs text-ink-muted">
                見終わったら、自分の言葉で答えてみましょう。そのあと「答えの目安」を開いて、自分の答えと見比べます(AIは採点しません)。
              </p>
              {questions.map((q, i) => (
                <div key={i} className="space-y-2">
                  <label htmlFor={`answer-${i}`} className="block text-sm font-medium text-ink">
                    {i + 1}. {q.question}
                  </label>
                  <textarea
                    id={`answer-${i}`}
                    name={`answer-${i}`}
                    rows={3}
                    maxLength={2000}
                    required
                    className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
                  />
                  {(q.answerPoints || q.evidence) && (
                    <details className="rounded-md bg-surface px-3 py-2 text-sm">
                      <summary className="cursor-pointer text-xs text-ink-muted">答えの目安を見る(書いてから開こう)</summary>
                      {q.answerPoints && <p className="mt-2">{q.answerPoints}</p>}
                      {q.evidence && <p className="mt-1 text-xs text-ink-muted">資料の該当箇所: {q.evidence}</p>}
                    </details>
                  )}
                  <fieldset className="flex flex-wrap gap-4 text-xs text-ink-muted">
                    <legend className="sr-only">自分の答えの確認</legend>
                    <label className="flex items-center gap-1"><input type="radio" name={`self-${i}`} value="ok" />目安と合っていた</label>
                    <label className="flex items-center gap-1"><input type="radio" name={`self-${i}`} value="more" />もう少し確かめたい</label>
                  </fieldset>
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-ink-muted">見終わったら、次へ進みましょう。</p>
          )}
          <SubmitButton
            pendingText="進んでいます…"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            インプットを終えて次へ
          </SubmitButton>
        </form>
      )}

      <BackLink href="/learn" label="授業一覧" />
    </div>
  );
}
