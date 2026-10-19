import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import {
  uploadMaterialAction,
  generateMaterialRagAction,
  generateAllPendingRagAction,
  shareMaterialAction,
  unshareMaterialAction,
  updateAutoDiscussionSettingsAction,
  updateCourseSettingsAction,
  regenerateJoinCodeAction,
  startStudentViewAction,
  removeEnrollmentAction,
  approveEnrollmentAction,
  registerStudentAction,
} from "./actions";
import { TEMPO_OPTIONS } from "@/lib/discussion-tempo";
import {
  DISCUSSION_STYLES,
  LEARNER_LEVELS,
  TIME_LIMIT_OPTIONS,
  TIME_LIMIT_POLICIES,
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
      "id, title, subject, owner_teacher_id, join_code, auto_discussion_tempo_seconds, auto_discussion_affects_evaluation, objective, learner_level, discussion_style, ai_member_count, discussion_liveliness, time_limit_minutes, time_limit_policy, time_limit_affects_evaluation, ai_close_suggestion",
    )
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  // F01拡張(受講登録): 参加登録している学習者の一覧(名前が無い場合はメールアドレスで表示)。
  const { data: enrollmentRows } = await admin
    .from("course_enrollments")
    .select("student_id, status, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  const enrolledStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "approved").map((e) => e.student_id);
  const pendingStudentIds = (enrollmentRows ?? []).filter((e) => e.status === "pending").map((e) => e.student_id);
  const allEnrollmentStudentIds = (enrollmentRows ?? []).map((e) => e.student_id);
  const { data: enrolledProfiles } =
    allEnrollmentStudentIds.length > 0
      ? await admin.from("profiles").select("id, display_name, email").in("id", allEnrollmentStudentIds)
      : { data: [] };
  const profileById = new Map((enrolledProfiles ?? []).map((p) => [p.id, p]));

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
  const boundRegenerateJoinCodeAction = regenerateJoinCodeAction.bind(null, courseId);
  const boundRegisterStudentAction = registerStudentAction.bind(null, courseId);
  const boundUpdateCourseSettingsAction = updateCourseSettingsAction.bind(null, courseId);
  const boundStartStudentViewAction = startStudentViewAction.bind(null, courseId);
  const canViewAsStudent = await isAdmin(admin, user.id);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{course.title}</h1>
      {course.subject && <p className="mt-1 text-sm text-ink-muted">{course.subject}</p>}

      <Link
        href={`/courses/${courseId}/dashboard`}
        className="mt-4 inline-block text-sm text-ink-muted hover:underline"
      >
        教師ダッシュボード(F14)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/personas`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        ペルソナ設定(F03/F04)→
      </Link>
      <br />
      {canViewAsStudent && (
        <form action={boundStartStudentViewAction} className="mt-1">
          <button type="submit" className="text-sm text-ink-muted hover:underline">
            学習者として表示(動作確認・管理者のみ)→
          </button>
        </form>
      )}
      <Link
        href={`/courses/${courseId}/criteria`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        評価の観点(F07)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/submissions`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        提出物とフィードバック(F06/F07)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/students`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        学習者プロファイル(F09)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/conformity`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        ペルソナ設計と同調の計測(F20)→
      </Link>
      <br />
      <Link
        href={`/courses/${courseId}/audit`}
        className="mt-1 inline-block text-sm text-ink-muted hover:underline"
      >
        擬似メンバーの発言の監査と修正(F15)→
      </Link>
      <p className="mt-1 text-sm text-ink-muted">
        学習者ビュー(F05): 生徒アカウントでログインし
        <Link href={`/learn/${courseId}`} className="mx-1 hover:underline">
          /learn/{courseId}
        </Link>
        を開くと擬似メンバーと議論できる
      </p>

      <form action={boundUpdateCourseSettingsAction} className="mt-8 space-y-4 rounded-lg border border-line p-5">
        <div>
          <h2 className="text-sm font-medium text-ink">授業の設定</h2>
          <p className="mt-1 text-sm text-ink-muted">
            ここで設定した内容は、AI擬似メンバーの発言と、ペルソナ設定の「AIにペルソナ案を作ってもらう」の
            両方に反映されます。特に「授業のねらい・議題」を書くと、議論が授業の目的からそれにくくなります。
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

        <div className="space-y-1 border-t border-line pt-4">
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
            学習者の発言のあと、擬似メンバーが続けて何発言まで話してよいかの上限です(擬似メンバーが2人以上いる
            授業のとき)。誰が話すかは、各メンバーの性格・視点・発言頻度・介入の条件から、AIが場面ごとに
            決めます。メンバー同士で議論することもあり、最後は学習者に話を返します。
          </p>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
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
              時間の超過を、評価の参考にする(学習者の画面には「評価の参考にされます」と表示されます。
              AIが点数を変えるわけではなく、先生が振り返るときの目印です)
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
              AIが議論の状態(結論が出た・堂々めぐり・脱線)を見て、「そろそろまとめましょう」と提案する
              (AIが勝手に止めることはありません。判定は数発言ごとに1回AIを呼びます)
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

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">受講登録</h2>
        <p className="mt-1 text-sm text-ink-muted">
          学習者にこの授業コードを伝えてください。学習者が「授業に参加する」画面でこのコードを
          入力すると参加の申請になり、下の「承認待ち」であなたが承認すると、授業に入れるように
          なります。コードを使わず、あなたが直接学習者を登録することもできます。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-md border border-line bg-surface-raised px-3 py-1.5 font-mono text-lg tracking-widest text-ink">
            {course.join_code}
          </span>
          <form action={boundRegenerateJoinCodeAction}>
            <button
              type="submit"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
            >
              コードを再発行する
            </button>
          </form>
        </div>

        {pendingStudentIds.length > 0 && (
          <div className="mt-4 rounded-md border border-warn bg-warn-soft p-3">
            <h3 className="text-xs font-medium text-warn">承認待ち({pendingStudentIds.length}人)</h3>
            <ul className="mt-2 space-y-1">
              {pendingStudentIds.map((studentId) => {
                const profile = profileById.get(studentId);
                const boundApproveAction = approveEnrollmentAction.bind(null, courseId, studentId);
                const boundRejectAction = removeEnrollmentAction.bind(null, courseId, studentId);
                return (
                  <li
                    key={studentId}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                  >
                    <span className="text-ink">{profile?.display_name || profile?.email || studentId}</span>
                    <span className="flex items-center gap-2">
                      <form action={boundApproveAction}>
                        <button
                          type="submit"
                          className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover"
                        >
                          承認する
                        </button>
                      </form>
                      <form action={boundRejectAction}>
                        <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                          却下する
                        </button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <h3 className="mt-4 text-xs font-medium text-ink-faint">
          参加している学習者({enrolledStudentIds.length}人)
        </h3>
        <ul className="mt-2 space-y-1">
          {enrolledStudentIds.map((studentId) => {
            const profile = profileById.get(studentId);
            const boundRemoveAction = removeEnrollmentAction.bind(null, courseId, studentId);
            return (
              <li
                key={studentId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              >
                <span className="text-ink-muted">{profile?.display_name || profile?.email || studentId}</span>
                <form action={boundRemoveAction}>
                  <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                    参加登録を外す
                  </button>
                </form>
              </li>
            );
          })}
          {enrolledStudentIds.length === 0 && (
            <li className="text-sm text-ink-muted">まだ誰も参加していません。</li>
          )}
        </ul>

        <form action={boundRegisterStudentAction} className="mt-5 space-y-2 border-t border-line pt-4">
          <h3 className="text-xs font-medium text-ink-faint">学習者を直接登録する</h3>
          <p className="text-xs text-ink-muted">
            アカウントが無ければ、ここで決めた初期パスワードで作ります(本人に直接伝え、ログイン後に
            「パスワード変更」で変えてもらってください)。既にアカウントがある場合は、パスワードは
            変えずに参加登録だけ行います。
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="reg-name">お名前</label>
            <input
              id="reg-name"
              name="name"
              required
              placeholder="お名前"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-email">メールアドレス</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              required
              placeholder="メールアドレス"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
            <label className="sr-only" htmlFor="reg-password">初期パスワード(10文字以上)</label>
            <input
              id="reg-password"
              name="password"
              type="text"
              minLength={10}
              autoComplete="off"
              placeholder="初期パスワード(10文字以上)"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
            />
          </div>
          <SubmitButton
            pendingText="登録中…"
            className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            登録する
          </SubmitButton>
        </form>
      </div>

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">沈黙時の自動継続(テンポ)</h2>
        <p className="mt-1 text-sm text-ink-muted">
          学習者がしばらく発言しない時、擬似メンバー同士で会話を少しだけ自動的に続けさせるかどうかの
          既定値。学習者は自分の授業画面でこの秒数を自分用に上書きできる(オフにもできる)。
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
      </div>

      <form
        action={boundUploadAction}
        className="mt-8 space-y-3 rounded-lg border border-line p-5"
      >
        <h2 className="text-sm font-medium text-ink">資料を追加</h2>

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

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">
          資料と知識ベース(RAG)
        </h2>
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
                        共有ライブラリに公開中(F21)
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
                        共有ライブラリに公開する(F21)
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
  );
}
