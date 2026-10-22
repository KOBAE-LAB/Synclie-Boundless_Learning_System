import { LESSON_STATUS_CLASSES, LESSON_STATUS_LABELS, lessonStatus } from "@/lib/courses/lesson-status";
import Link from "next/link";
import { CANONICAL_STAGES } from "@/lib/inquiry/stages";
import { StepNumber } from "@/components/step-number";
import { notFound } from "next/navigation";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { lessonName, loadLessonCrumbs } from "@/lib/courses/series";
import {
  uploadMaterialAction,
  generateMaterialRagAction,
  generateAllPendingRagAction,
  shareMaterialAction,
  unshareMaterialAction,
  updateAutoDiscussionSettingsAction,
  updateCourseSettingsAction,
  startStudentViewAction,
  setLessonClosedAction,
  setLessonReleasedAction,
  renameLessonAction,
} from "./actions";
import { TEMPO_OPTIONS } from "@/lib/discussion-tempo";
import {
  DISCUSSION_STYLES,
  LEARNER_LEVELS,
  TIME_LIMIT_OPTIONS,
  TIME_LIMIT_POLICIES,
  REASONING_DEPTHS,
} from "@/lib/courses/settings";
import { LIVELINESS } from "@/lib/ai/persona-scene";

const KIND_LABELS: Record<string, string> = {
  syllabus: "シラバス",
  pdf: "PDF",
  word: "Word",
  ppt: "PowerPoint",
  text: "テキスト",
  video_subtitle: "動画字幕",
  url: "URL",
};

const RAG_STATUS_LABELS: Record<string, string> = {
  pending: "未処理",
  processing: "処理中",
  done: "完了",
  failed: "失敗",
};

const RAG_STATUS_STYLES: Record<string, string> = {
  pending: "bg-surface text-ink-muted",
  processing: "bg-warn-soft text-warn",
  done: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
};

function MenuCard({
  href,
  title,
  description,
  badge,
  step,
}: {
  href: string;
  title: string;
  description: string;
  badge?: string;
  step?: number;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-surface-raised"
    >
      <span className="flex items-center text-sm font-medium text-ink">
        {step !== undefined && <StepNumber n={step} />}
        {title}
        {badge && (
          <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{badge}</span>
        )}
      </span>
      <span className="text-xs leading-5 text-ink-muted">{description}</span>
    </Link>
  );
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select(
      "id, title, subject, owner_teacher_id, series_id, lesson_no, released, closed_at, auto_discussion_tempo_seconds, auto_discussion_affects_evaluation, objective, learner_level, discussion_style, ai_member_count, discussion_liveliness, reasoning_depth, time_limit_minutes, time_limit_policy, time_limit_affects_evaluation, ai_close_suggestion, expected_stage_key",
    )
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const crumbs = await loadLessonCrumbs(admin, courseId);
  const lessonState = lessonStatus({ released: course.released, closed_at: course.closed_at ?? null }, crumbs?.endedBy === "series");

  const { data: materials } = await admin
    .from("course_materials")
    .select("id, kind, title, source_url, rag_status, rag_error, shared_at, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const { data: chunkRows } = await admin
    .from("material_chunks")
    .select("material_id")
    .eq("course_id", courseId);

  const chunkCountByMaterial = new Map<string, number>();
  for (const row of chunkRows ?? []) {
    if (!row.material_id) continue;
    chunkCountByMaterial.set(row.material_id, (chunkCountByMaterial.get(row.material_id) ?? 0) + 1);
  }

  const pendingCount = (materials ?? []).filter(
    (m) => m.rag_status === "pending" || m.rag_status === "failed",
  ).length;

  const boundUploadAction = uploadMaterialAction.bind(null, courseId);
  const boundGenerateAllAction = generateAllPendingRagAction.bind(null, courseId);
  const boundUpdateAutoDiscussionAction = updateAutoDiscussionSettingsAction.bind(null, courseId);
  const boundUpdateCourseSettingsAction = updateCourseSettingsAction.bind(null, courseId);
  const boundStartStudentViewAction = startStudentViewAction.bind(null, courseId);
  const canViewAsStudent = await isAdmin(admin, user.id);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={crumbs?.teacherTrail.slice(0, 2) ?? [{ label: "教科・科目一覧", href: "/courses" }]} current={lessonName(course.lesson_no, course.title)} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{lessonName(course.lesson_no, course.title)}</h1>
      {crumbs && <p className="mt-1 text-sm text-ink-muted">{crumbs.seriesTitle}の授業回</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line p-4">
        <p className="text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LESSON_STATUS_CLASSES[lessonState]}`}>{LESSON_STATUS_LABELS[lessonState]}</span>
          <span className="ml-2 text-xs text-ink-muted">
            {lessonState === "preparing"
              ? "公開するまで、学習者には見えません。"
              : lessonState === "open"
                ? "履修している学習者が開けます。"
                : crumbs?.endedBy === "series"
                  ? "教科・科目が終了しています。記録の閲覧のみです。"
                  : "記録の閲覧のみです。新しい発言・提出はできません。"}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {lessonState === "preparing" && (
            <form action={setLessonReleasedAction.bind(null, courseId, true)}>
              <SubmitButton pendingText="変更中…" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                学習者に公開する
              </SubmitButton>
            </form>
          )}
          {lessonState === "open" && (
            <>
              <form action={setLessonReleasedAction.bind(null, courseId, false)}>
                <button type="submit" className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink">準備中に戻す</button>
              </form>
              <form action={setLessonClosedAction.bind(null, courseId, true)}>
                <SubmitButton pendingText="変更中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                  授業回を終了する
                </SubmitButton>
              </form>
            </>
          )}
          {lessonState === "closed" && crumbs?.endedBy !== "series" && (
            <form action={setLessonClosedAction.bind(null, courseId, false)}>
              <SubmitButton pendingText="変更中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                再開する
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">授業回の名前を変える</summary>
        <form action={renameLessonAction.bind(null, courseId)} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="lesson-title" className="sr-only">授業回の名前</label>
          <input
            id="lesson-title"
            name="title"
            defaultValue={course.title}
            maxLength={80}
            required
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
          />
          <SubmitButton pendingText="保存中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
            保存
          </SubmitButton>
        </form>
      </details>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">1. 授業を準備する</h2>
        <p className="mt-2 text-sm text-ink-muted">ねらいや資料を入れ、擬似メンバーを用意します。</p>
      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink"><StepNumber n={1} />授業の設定</summary>
      <form action={boundUpdateCourseSettingsAction} className="mt-4 space-y-4">
        <div>
          <p className="mt-1 text-sm text-ink-muted">
            AIの発言とペルソナ案に反映されます。「ねらい・議題」を書くと、議論が授業の目的に沿います。
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="course-objective" className="text-sm font-medium text-ink">
            授業のねらい・議題
          </label>
          <textarea
            id="course-objective"
            name="objective"
            rows={3}
            maxLength={1000}
            defaultValue={course.objective ?? ""}
            placeholder="例: 光の強さと光合成の速さの関係を、資料のグラフを根拠に説明しあう"
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-level" className="text-sm font-medium text-ink">
              学習者の校種・学年
            </label>
            <select
              id="course-level"
              name="learnerLevel"
              defaultValue={course.learner_level ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {LEARNER_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-style" className="text-sm font-medium text-ink">
              討論の型
            </label>
            <select
              id="course-style"
              name="discussionStyle"
              defaultValue={course.discussion_style ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {Object.entries(DISCUSSION_STYLES).map(([key, style]) => (
                <option key={key} value={key}>
                  {style.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem] flex-1 space-y-1">
            <label htmlFor="course-expected-stage" className="text-sm font-medium text-ink">
              この回で想定する探究の段階
            </label>
            <select
              id="course-expected-stage"
              name="expectedStageKey"
              defaultValue={course.expected_stage_key ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {CANONICAL_STAGES.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </div>

          <div className="w-32 space-y-1">
            <label htmlFor="course-ai-count" className="text-sm font-medium text-ink">
              AIメンバーの人数
            </label>
            <select
              id="course-ai-count"
              name="aiMemberCount"
              defaultValue={course.ai_member_count?.toString() ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
            >
              <option value="">指定しない</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}人
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1 border-t border-line-soft pt-4">
          <label htmlFor="course-liveliness" className="text-sm font-medium text-ink">
            擬似メンバーの発言の活発さ
          </label>
          <select
            id="course-liveliness"
            name="discussionLiveliness"
            defaultValue={course.discussion_liveliness ?? "normal"}
            className="w-full max-w-xs rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          >
            {Object.entries(LIVELINESS).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            学習者の発言のあと、擬似メンバーが続けて話せる発言数の上限(2人以上のとき)。
          </p>
        </div>

        <div className="space-y-1 border-t border-line-soft pt-4">
          <label htmlFor="course-reasoning" className="text-sm font-medium text-ink">
            AIの推論の深さ
          </label>
          <select
            id="course-reasoning"
            name="reasoningDepth"
            defaultValue={course.reasoning_depth ?? "standard"}
            className="w-full max-w-md rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
          >
            {Object.entries(REASONING_DEPTHS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            擬似メンバーの発言を作るAIの考える深さ。深いほど、遅く、費用も増えます。
          </p>
        </div>

        <div className="space-y-3 border-t border-line-soft pt-4">
          <h3 className="text-xs font-medium text-ink-faint">議論の終わり</h3>
          <div className="flex flex-wrap gap-4">
            <div className="min-w-[10rem] space-y-1">
              <label htmlFor="course-time-limit" className="text-sm font-medium text-ink">
                制限時間
              </label>
              <select
                id="course-time-limit"
                name="timeLimitMinutes"
                defaultValue={course.time_limit_minutes?.toString() ?? ""}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
              >
                <option value="">制限なし</option>
                {TIME_LIMIT_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="course-time-policy" className="text-sm font-medium text-ink">
                時間を過ぎたとき
              </label>
              <select
                id="course-time-policy"
                name="timeLimitPolicy"
                defaultValue={course.time_limit_policy ?? "soft"}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm"
              >
                {Object.entries(TIME_LIMIT_POLICIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            制限時間は、学習者の最初の発言から数えます(学習者の画面に残り時間が出ます)。
          </p>
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="timeLimitAffectsEvaluation"
              defaultChecked={course.time_limit_affects_evaluation}
              className="mt-1"
            />
            <span>
              時間の超過を、評価の参考にする(先生が振り返るときの目印。点数は変わりません)
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="aiCloseSuggestion"
              defaultChecked={course.ai_close_suggestion}
              className="mt-1"
            />
            <span>
              AIが議論の状態を見て、「そろそろまとめましょう」と提案する(止めることはしません)
            </span>
          </label>
        </div>

        <SubmitButton
          pendingText="保存中…"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
        >
          設定を保存
        </SubmitButton>
      </form>
      </details>

      <details open className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          <StepNumber n={2} />
          資料の登録
          <span className="ml-2 text-xs font-normal text-ink-muted">{(materials ?? []).length}件</span>
        </summary>
        <p className="mt-2 text-sm text-ink-muted">
          登録した資料の範囲で、擬似メンバーが発言します。
        </p>
        <div className="mt-3">
      <form
        action={boundUploadAction}
        className="space-y-3 rounded-md border border-line p-4"
      >
        <h3 className="text-xs font-medium text-ink-faint">資料を追加</h3>

        <label htmlFor="material-kind" className="sr-only">
          資料の種類
        </label>
        <select
          id="material-kind"
          name="kind"
          required
          defaultValue=""
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        >
          <option value="" disabled>
            種類を選択
          </option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label htmlFor="material-title" className="sr-only">
          資料のタイトル
        </label>
        <input
          id="material-title"
          name="title"
          placeholder="資料のタイトル"
          required
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />

        <label htmlFor="material-url" className="sr-only">
          URL
        </label>
        <input
          id="material-url"
          name="url"
          placeholder="URL(種類が「URL」の場合のみ)"
          type="url"
          className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
        />

        <label htmlFor="material-file" className="sr-only">
          ファイル
        </label>
        <input
          id="material-file"
          name="file"
          type="file"
          className="w-full text-sm text-ink"
        />
        <p className="text-xs text-ink-muted">
          「URL」を選んだ場合はURL欄のみ、それ以外はファイルを選択してください。
        </p>

        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
        >
          追加する
        </button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-faint">登録済みの資料と知識ベース(RAG)</h3>
        {pendingCount > 0 && (
          <form action={boundGenerateAllAction}>
            <SubmitButton
              pendingText="生成中…"
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
            >
              未処理の資料をまとめて生成({pendingCount}件)
            </SubmitButton>
          </form>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {(materials ?? []).map((material) => {
          const boundGenerateOneAction = generateMaterialRagAction.bind(null, courseId, material.id);
          const boundShareAction = shareMaterialAction.bind(null, courseId, material.id);
          const boundUnshareAction = unshareMaterialAction.bind(null, courseId, material.id);
          const chunkCount = chunkCountByMaterial.get(material.id) ?? 0;
          const statusLabel = RAG_STATUS_LABELS[material.rag_status] ?? material.rag_status;
          const statusStyle =
            RAG_STATUS_STYLES[material.rag_status] ??
            "bg-surface text-ink-muted";

          return (
            <li
              key={material.id}
              className="rounded-md border border-line px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{material.title}</span>
                  <span className="ml-2 text-ink-muted">
                    [{KIND_LABELS[material.kind] ?? material.kind}]
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle}`}>
                    {statusLabel}
                    {material.rag_status === "done" && chunkCount > 0 && `(${chunkCount}チャンク)`}
                  </span>
                  <form action={boundGenerateOneAction}>
                    <SubmitButton
                      pendingText="生成中…"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
                    >
                      {material.rag_status === "done" ? "再生成" : "生成する"}
                    </SubmitButton>
                  </form>
                </div>
              </div>
              {material.rag_status === "failed" && material.rag_error && (
                <p className="mt-2 text-xs text-danger">{material.rag_error}</p>
              )}
              {material.kind === "syllabus" && (
                <div className="mt-2 flex items-center gap-2">
                  {material.shared_at ? (
                    <>
                      <span className="text-xs text-accent">
                        共有ライブラリに公開中
                      </span>
                      <form action={boundUnshareAction}>
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                        >
                          共有を取り消す
                        </button>
                      </form>
                    </>
                  ) : (
                    <form action={boundShareAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                      >
                        共有ライブラリに公開する
                      </button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {(!materials || materials.length === 0) && (
          <li className="text-sm text-ink-muted">まだ資料がありません。</li>
        )}
      </ul>
        </div>
      </details>
      <nav aria-label="授業の準備のメニュー" className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        <MenuCard
          href={`/courses/${courseId}/personas`}
          title="ペルソナ設定"
          step={3}
          description="擬似メンバーを作り、承認して「使用中」にする"
        />
        <MenuCard
          href={`/courses/${courseId}/flow`}
          title="学習の流れ"
          step={4}
          description="インプットとアウトプットの順番・時間を設計"
        />
        <MenuCard
          href={`/courses/${courseId}/criteria`}
          title="評価の観点"
          step={5}
          description="フィードバックの観点を設定"
        />
      </nav>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">2. 学習者の進め方</h2>
        <p className="mt-2 text-sm text-ink-muted">
          履修登録(授業コード・承認)は、教科・科目のページで管理します。
          <Link href={`/series/${course.series_id}`} className="ml-1 text-accent underline underline-offset-2 hover:text-accent-dark">履修登録を開く →</Link>
        </p>
      <details className="mt-4 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">沈黙時の自動継続(テンポ・任意)</summary>
        <p className="mt-1 text-sm text-ink-muted">
          学習者がしばらく発言しないとき、擬似メンバー同士の会話を少しだけ自動で続けるかの既定値です。
          学習者は自分用に変更・オフにできます。
        </p>
        <form action={boundUpdateAutoDiscussionAction} className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="block text-ink-muted">既定のテンポ</span>
            <select
              name="tempoSeconds"
              defaultValue={String(course.auto_discussion_tempo_seconds ?? 0)}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
            >
              {TEMPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              name="affectsEvaluation"
              defaultChecked={course.auto_discussion_affects_evaluation}
            />
            このテンポ設定を評価の参考にする(学習者の授業画面にもその旨を表示します)
          </label>
          <button
            type="submit"
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
          >
            保存する
          </button>
        </form>
      </details>

      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">3. 学習の様子を確認する</h2>
        <p className="mt-2 text-sm text-ink-muted">参加状況・提出物・擬似メンバーの挙動を見て、指導や設定の見直しに活かします。</p>
      <nav aria-label="学習の様子を確認するメニュー" className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        <MenuCard
          href={`/courses/${courseId}/dashboard`}
          title="教師ダッシュボード"
          description="参加状況・つまずき・擬似メンバーの挙動をまとめて確認"
        />
        <MenuCard
          href={`/courses/${courseId}/submissions`}
          title="提出物とフィードバック"
          description="学習者の成果と、AIのフィードバックの確認・修正"
        />
        <MenuCard
          href={`/courses/${courseId}/students`}
          title="学習者プロファイル"
          description="学習者ごとの得意・課題と、個別最適化の提案"
        />
        <MenuCard
          href={`/courses/${courseId}/conformity`}
          title="同調の計測"
          description="擬似メンバーが根拠なく同調した割合を、ペルソナ別に確認"
        />
        <MenuCard
          href={`/courses/${courseId}/audit`}
          title="発言の監査と修正"
          description="擬似メンバーの発言を確認し、不適切な内容を修正"
        />
        {canViewAsStudent && (
          <form action={boundStartStudentViewAction} className="contents">
            <button
              type="submit"
              className="flex flex-col gap-1 rounded-lg border border-dashed border-line-strong p-4 text-left transition-colors hover:border-accent hover:bg-surface"
            >
              <span className="text-sm font-medium text-ink">学習者として表示 →</span>
              <span className="text-xs leading-5 text-ink-muted">
                動作確認用(管理者のみ)。テスト学習者として、学習者の画面を試せます
              </span>
            </button>
          </form>
        )}
      </nav>
      <p className="mt-2 text-xs text-ink-faint">
        学習者は、ログイン後の授業一覧(参加が承認された授業)から、この授業を開きます。
      </p>
      </section>

      <BackLink href={crumbs ? `/series/${crumbs.seriesId}` : "/courses"} label={crumbs?.seriesTitle ?? "教科・科目一覧"} />
    </div>
  );
}
