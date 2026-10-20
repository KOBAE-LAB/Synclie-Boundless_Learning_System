import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { readCheckQuestions, STEP_KIND_LABELS } from "@/lib/flow/steps";
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
    <select name={name} defaultValue={defaultValue} className={input} aria-label="資料">
      <option value="">(資料なし)</option>
      {materials.map((m) => (
        <option key={m.id} value={m.id}>
          {m.title}({m.kind}{m.rag_status === "done" ? "" : "・RAG未生成"})
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId))?.teacherTrail ?? [])]} current="学習の流れ" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">学習の流れ</h1>
      <p className="mt-1 text-sm text-ink-muted">
        動画・資料で学ぶ<b>インプット</b>と、議論で深める<b>アウトプット</b>を好きな順に並べます。
        ステップが無ければ、これまでどおり議論だけの授業です。
      </p>

      <form action={updateFlowSettingsAction.bind(null, courseId)} className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="stepsInOrder" defaultChecked={course.steps_in_order !== false} className="mt-1" />
          <span>
            順番どおりに進める
            <span className="block text-xs text-ink-muted">インプットを終えるまで議論に入れません(オフなら自由に行き来できます)。</span>
          </span>
        </label>
        <SubmitButton className={btn} pendingText="保存中…">保存</SubmitButton>
      </form>

      <h2 className="mt-8 text-sm font-semibold text-ink">
        ステップ({steps.length}個{totalMinutes > 0 ? `・目安 合計${totalMinutes}分` : ""})
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => {
          const questions = readCheckQuestions(step.checkQuestions);
          return (
            <li key={step.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-sm font-medium text-ink">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${step.kind === "input" ? "bg-accent-soft text-accent" : "bg-success-soft text-success"}`}>
                    {i + 1}. {STEP_KIND_LABELS[step.kind]}
                  </span>
                  {step.title}
                  {step.minutes ? <span className="ml-2 text-xs font-normal text-ink-muted">目安{step.minutes}分</span> : null}
                  {step.videoPath ? <span className="ml-2 text-xs font-normal text-ink-muted">動画ファイルあり</span> : null}
                </p>
                <div className="flex flex-wrap gap-1">
                  <form action={moveStepAction.bind(null, courseId, step.id, "up")}>
                    <button type="submit" disabled={i === 0} className={btn} aria-label="上へ">↑</button>
                  </form>
                  <form action={moveStepAction.bind(null, courseId, step.id, "down")}>
                    <button type="submit" disabled={i === steps.length - 1} className={btn} aria-label="下へ">↓</button>
                  </form>
                  <form action={deleteStepAction.bind(null, courseId, step.id)}>
                    <button type="submit" className={`${btn} text-danger`}>削除</button>
                  </form>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-muted">内容を編集する</summary>
                <form action={updateStepAction.bind(null, courseId, step.id)} className="mt-3 space-y-2">
                  <label className="block text-xs text-ink-muted">
                    名前
                    <input name="title" required maxLength={80} defaultValue={step.title} className={`mt-1 ${input}`} />
                  </label>
                  <label className="block text-xs text-ink-muted">
                    学習者への指示(このステップで取り組むこと)
                    <textarea name="instruction" rows={2} maxLength={600} defaultValue={step.instruction} className={`mt-1 ${input}`} />
                  </label>
                  {step.kind === "input" && (
                    <>
                      <label className="block text-xs text-ink-muted">
                        動画サイトのURL(学習者にはリンクとして表示されます。任意)
                        <input name="videoUrl" defaultValue={step.videoUrl ?? ""} placeholder="https://www.youtube.com/watch?v=..." className={`mt-1 ${input}`} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        動画ファイル(mp4・webm、20MBまで。画面内で再生されます)
                        <input name="videoFile" type="file" accept="video/mp4,video/webm" className={`mt-1 ${input}`} />
                      </label>
                      {step.videoPath && (
                        <label className="flex items-center gap-2 text-xs text-ink-muted">
                          <input type="checkbox" name="removeVideoFile" />
                          いま登録している動画ファイルを取り除く(新しいファイルを選ぶと差し替わります)
                        </label>
                      )}
                      <label className="block text-xs text-ink-muted">
                        資料(学習者が読む資料。動画の場合は字幕の資料にすると、理解チェックを作れます)
                        <span className="mt-1 block">{materialSelect("materialId", step.materialId ?? "")}</span>
                      </label>
                    </>
                  )}
                  <label className="block text-xs text-ink-muted">
                    時間の目安(分。任意)
                    <input name="minutes" type="number" min={1} max={240} defaultValue={step.minutes ?? ""} className={`mt-1 w-28 ${input}`} />
                  </label>
                  <SubmitButton className={primary} pendingText="保存中…">保存</SubmitButton>
                </form>
              </details>

              {step.kind === "input" && (
                <details className="mt-3" open={questions.length > 0}>
                  <summary className="cursor-pointer text-xs text-ink-muted">理解チェックの問い({questions.length}問)</summary>
                  <p className="mt-2 text-xs text-ink-faint">
                    インプットのあとに学習者が自分の言葉で答え、「答えの目安」と見比べて自分で確かめます(AIは採点しません)。
                    問いを空にすると削除されます。
                  </p>
                  <form action={generateCheckQuestionsAction.bind(null, courseId, step.id)} className="mt-2">
                    <SubmitButton className={btn} pendingText="作成中…">
                      {questions.length > 0 ? "AIで作り直す" : "AIで問いを作る(資料が必要)"}
                    </SubmitButton>
                  </form>
                  <form action={saveCheckQuestionsAction.bind(null, courseId, step.id)} className="mt-3 space-y-3">
                    {Array.from({ length: Math.max(questions.length, 1) + (questions.length < 6 ? 1 : 0) }, (_, qi) => {
                      const q = questions[qi];
                      return (
                        <div key={qi} className="space-y-1 rounded-md border border-line p-3">
                          <input name={`question-${qi}`} defaultValue={q?.question ?? ""} placeholder={`問い${qi + 1}`} aria-label={`問い${qi + 1}`} className={input} />
                          <input name={`answerPoints-${qi}`} defaultValue={q?.answerPoints ?? ""} placeholder="答えの目安" aria-label={`問い${qi + 1}の答えの目安`} className={input} />
                          <input name={`evidence-${qi}`} defaultValue={q?.evidence ?? ""} placeholder="資料の該当箇所(任意)" aria-label={`問い${qi + 1}の資料の該当箇所`} className={input} />
                        </div>
                      );
                    })}
                    <SubmitButton className={btn} pendingText="保存中…">問いを保存</SubmitButton>
                  </form>
                </details>
              )}
            </li>
          );
        })}
        {steps.length === 0 && <li className="text-sm text-ink-muted">まだステップがありません。下のフォームから追加してください。</li>}
      </ol>

      <form action={addStepAction.bind(null, courseId)} className="mt-6 space-y-3 rounded-lg border border-line p-4">
        <h2 className="text-sm font-semibold text-ink">ステップを追加する</h2>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">種類</legend>
          <label className="flex items-center gap-1"><input type="radio" name="kind" value="input" defaultChecked />インプット(動画・資料)</label>
          <label className="flex items-center gap-1"><input type="radio" name="kind" value="output" />アウトプット(議論)</label>
        </fieldset>
        <label className="block text-xs text-ink-muted">
          名前
          <input name="title" required maxLength={80} placeholder="例: 光合成の動画を見る / 資料をふまえて議論する" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          学習者への指示(任意)
          <textarea name="instruction" rows={2} maxLength={600} placeholder="例: 動画のポイントを3つ見つけながら見よう" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          動画サイトのURL(インプットのみ。リンクとして表示されます)
          <input name="videoUrl" placeholder="https://www.youtube.com/watch?v=..." className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          動画ファイル(インプットのみ。mp4・webm、20MBまで。大きい動画は上のURLを使います)
          <input name="videoFile" type="file" accept="video/mp4,video/webm" className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs text-ink-muted">
          資料(インプットのみ)
          <span className="mt-1 block">{materialSelect("materialId", "")}</span>
        </label>
        <label className="block text-xs text-ink-muted">
          時間の目安(分。任意)
          <input name="minutes" type="number" min={1} max={240} className={`mt-1 w-28 ${input}`} />
        </label>
        <SubmitButton className={primary} pendingText="追加中…">ステップを追加</SubmitButton>
      </form>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
