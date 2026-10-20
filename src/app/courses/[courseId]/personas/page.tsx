import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import {
  createPersonaAction,
  deletePersonaAction,
  approvePersonaAction,
  activatePersonaAction,
  deactivatePersonaAction,
  generateEvolvedPersonasAction,
  recommendPersonaDraftsAction,
  recommendPersonaAvatarAction,
  setPersonaAvatarAction,
  sharePersonaAction,
  unsharePersonaAction,
  type PersonaStatus,
} from "./actions";
import { PersonaForm } from "./persona-form";
import { assignPersonaTones, toneClass } from "@/lib/persona-tones";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

type AvatarStatus = "pending" | "done" | "failed";

interface PersonaRow {
  id: string;
  created_at?: string;
  name: string;
  tier: string;
  status: PersonaStatus;
  profile: { role?: string } | null;
  origin_note: string | null;
  shared_at: string | null;
  avatar_id: string | null;
  avatar_status: AvatarStatus;
  avatar_error: string | null;
}

interface AvatarOptionRow {
  id: string;
  file_path: string;
  label: string;
}

const AVATAR_STATUS_LABELS: Record<AvatarStatus, string> = {
  pending: "未推薦",
  done: "推薦済み",
  failed: "推薦に失敗",
};

interface CorpusEntryRow {
  id: string;
  topic: string;
  misconception: string | null;
  effective_question: string | null;
}

const TIER_LABELS: Record<string, string> = {
  teacher_defined: "教師設定型",
  rag_initial: "RAG初期型",
  evolved: "学習進化型",
};

const STATUS_LABELS: Record<PersonaStatus, string> = {
  draft: "下書き",
  approved: "承認済み",
  active: "使用中",
};

const STATUS_STYLES: Record<PersonaStatus, string> = {
  draft: "bg-surface text-ink-muted",
  approved: "bg-warn-soft text-warn",
  active: "bg-success-soft text-success",
};

export default async function PersonasPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id, objective, learner_level, discussion_style, ai_member_count")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { data: personas } = await admin
    .from("personas")
    .select("id, name, tier, status, profile, origin_note, shared_at, avatar_id, avatar_status, avatar_error, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const { data: corpusEntries } = await admin
    .from("learner_corpus_entries")
    .select("id, topic, misconception, effective_question")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  // F25: アバター候補プール(全授業共通)。ラベルの五十音順で選択肢を並べる。
  const { data: avatarOptions } = await admin
    .from("avatar_options")
    .select("id, file_path, label")
    .order("label", { ascending: true });
  const avatarOptionRows = (avatarOptions ?? []) as AvatarOptionRow[];
  const avatarById = new Map(avatarOptionRows.map((a) => [a.id, a]));

  const rows = (personas ?? []) as PersonaRow[];
  const activeCount = rows.filter((p) => p.status === "active").length;
  // ペルソナごとの色(学習者の画面の吹き出し・映像タイルと同じ。作成順で割り当てる)
  const personaTones = assignPersonaTones(
    [...rows].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")).map((p) => p.id),
  );
  const boundCreateAction = createPersonaAction.bind(null, courseId);
  const boundGenerateEvolvedAction = generateEvolvedPersonasAction.bind(null, courseId);
  const boundRecommendDraftsAction = recommendPersonaDraftsAction.bind(null, courseId);
  const targetCount = course.ai_member_count as number | null;
  // 目標人数に対して、あと何人分の案を作ればよいか(使用中・承認済み・下書きをすべて数える)
  const remainingToTarget = targetCount ? Math.max(targetCount - rows.length, 0) : null;
  const defaultRecommendCount = Math.min(Math.max(remainingToTarget ?? 2, 1), 5);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId))?.teacherTrail ?? [])]} current="ペルソナ設定" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        ペルソナ設定
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        擬似メンバーを作り、承認して「使用中」にすると授業で使われます。
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        この授業で使用中のペルソナ: <span className="font-medium">{activeCount}体</span>
      </p>

      {targetCount !== null && (
        <p
          className={`mt-1 text-sm ${activeCount === targetCount ? "text-ink-muted" : "text-warn"}`}
        >
          授業設定のAIメンバー目標: {targetCount}人
          {activeCount === targetCount
            ? "(使用中の人数と一致しています)"
            : activeCount < targetCount
              ? `(あと${targetCount - activeCount}人を「使用中」にすると、目標に届きます)`
              : `(使用中が目標より${activeCount - targetCount}人多くなっています)`}
        </p>
      )}

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">AIにペルソナ案を作ってもらう</h2>
        <p className="mt-1 text-sm text-ink-muted">
          授業設定と資料をもとに、互いに補い合う案を作ります。案は<strong>下書き</strong>として下に並び、
          確認・修正して承認→「使用中」にして初めて使われます。
        </p>
        {!course.objective && (
          <p className="mt-2 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
            授業のねらい・議題が未入力です。入力すると、案が授業の目的に沿ったものになります。
            <Link href={`/courses/${courseId}`} className="ml-1 underline">
              授業の設定へ
            </Link>
          </p>
        )}
        <form action={boundRecommendDraftsAction} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="recommend-count" className="text-xs font-medium text-ink-muted">
                作る人数
              </label>
              <select
                id="recommend-count"
                name="count"
                defaultValue={defaultRecommendCount}
                className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}人分
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="recommend-hint" className="text-xs font-medium text-ink-muted">
                ヒント(任意。例: 反対意見の中学生、慎重な先輩)
              </label>
              <input
                id="recommend-hint"
                name="hint"
                maxLength={200}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <SubmitButton
            pendingText="案を作っています…"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            ペルソナ案を作る
          </SubmitButton>
          <p className="text-xs text-ink-faint">
            AI呼び出しを1回行います(数秒〜十数秒かかります)。人数を1にして、ヒントを書くと、
            1体ずつ追加できます。
          </p>
        </form>
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink">
        この授業のペルソナ({rows.length}体)
      </h2>
      <ul className="mt-3 space-y-2">
        {rows.map((persona) => {
          const boundDeleteAction = deletePersonaAction.bind(null, courseId, persona.id);
          const boundApproveAction = approvePersonaAction.bind(null, courseId, persona.id);
          const boundActivateAction = activatePersonaAction.bind(null, courseId, persona.id);
          const boundDeactivateAction = deactivatePersonaAction.bind(null, courseId, persona.id);
          const boundShareAction = sharePersonaAction.bind(null, courseId, persona.id);
          const boundUnshareAction = unsharePersonaAction.bind(null, courseId, persona.id);
          const boundRecommendAvatarAction = recommendPersonaAvatarAction.bind(
            null,
            courseId,
            persona.id,
          );
          const boundSetAvatarAction = setPersonaAvatarAction.bind(null, courseId, persona.id);
          const avatar = persona.avatar_id ? avatarById.get(persona.avatar_id) : undefined;

          return (
            <li
              key={persona.id}
              className={`rounded-md border border-l-4 border-line bg-surface px-4 py-3 text-sm ${toneClass(personaTones[persona.id])}`}
              style={{ borderLeftColor: "var(--tone)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/courses/${courseId}/personas/${persona.id}`}
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  {avatar ? (
                    <img
                      src={avatar.file_path}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="persona-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    >
                      {persona.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{persona.name}</span>
                    {persona.profile?.role && (
                      <span className="ml-2 text-ink-muted">({persona.profile.role})</span>
                    )}
                    <span className="ml-2 text-xs text-ink-faint">
                      [{TIER_LABELS[persona.tier] ?? persona.tier}]
                    </span>
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-2">
                  <ol className="flex items-center gap-1 text-[0.6875rem]" aria-label={`状態: ${STATUS_LABELS[persona.status]}`}>
                    {(["draft", "approved", "active"] as const).map((st, idx) => {
                      const order = { draft: 0, approved: 1, active: 2 } as const;
                      const reached = order[persona.status] >= idx;
                      const isNow = persona.status === st;
                      return (
                        <li
                          key={st}
                          aria-current={isNow ? "step" : undefined}
                          className={`rounded-full px-2 py-0.5 ${
                            isNow ? STATUS_STYLES[st] + " font-semibold" : reached ? "bg-surface text-ink-muted" : "text-ink-faint"
                          }`}
                        >
                          {idx + 1} {STATUS_LABELS[st]}
                        </li>
                      );
                    })}
                  </ol>

                  {persona.status === "draft" && (
                    <form action={boundApproveAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        次へ: 承認する
                      </button>
                    </form>
                  )}
                  {persona.status === "approved" && (
                    <form action={boundActivateAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        次へ: 授業で使う
                      </button>
                    </form>
                  )}
                  {persona.status === "active" && (
                    <form action={boundDeactivateAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        使用をやめる
                      </button>
                    </form>
                  )}

                  <form action={boundDeleteAction}>
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                    >
                      削除
                    </button>
                  </form>
                </div>
              </div>
              {persona.origin_note && (
                <p className="mt-2 text-xs text-ink-faint">生成理由: {persona.origin_note}</p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {persona.shared_at ? (
                  <>
                    <span className="text-xs text-accent">共有ライブラリに公開中</span>
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
                  persona.status !== "draft" && (
                    <form action={boundShareAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                      >
                        共有ライブラリに公開する
                      </button>
                    </form>
                  )
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className="text-xs text-ink-faint">
                  アバター: {AVATAR_STATUS_LABELS[persona.avatar_status]}
                  {avatar && ` — ${avatar.label}`}
                </span>
                <form action={boundRecommendAvatarAction}>
                  <SubmitButton
                    pendingText="推薦中…"
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface disabled:opacity-50"
                  >
                    {persona.avatar_id ? "AIに再推薦させる" : "AIに推薦させる"}
                  </SubmitButton>
                </form>
                <form action={boundSetAvatarAction} className="flex items-center gap-1">
                  <label className="sr-only" htmlFor={`avatar-select-${persona.id}`}>
                    アバターを手動で選択
                  </label>
                  <select
                    id={`avatar-select-${persona.id}`}
                    name="avatarId"
                    defaultValue={persona.avatar_id ?? ""}
                    className="rounded-md border border-line px-2 py-0.5 text-xs bg-surface-raised"
                  >
                    <option value="" disabled>
                      手動で選ぶ
                    </option>
                    {avatarOptionRows.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                  >
                    変更する
                  </button>
                </form>
              </div>
              {persona.avatar_status === "failed" && persona.avatar_error && (
                <p className="mt-1 text-xs text-danger">{persona.avatar_error}</p>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-sm text-ink-muted">まだペルソナがありません。上のフォームから作成してください。</li>
        )}
      </ul>

      <details className="mt-6 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          ペルソナを手動で作成する
        </summary>
        <div className="mt-4">
          <PersonaForm action={boundCreateAction} submitLabel="作成する" />
        </div>
      </details>

      <details className="mt-3 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          学習進化型ペルソナ
        </summary>
        <p className="mt-1 text-sm text-ink-muted">
          同意済みの学習者の記録から、3〜5個の下書きを作ります。個人が特定されないよう、同意済みが3人以上になるまで作れません。
        </p>
        <form action={boundGenerateEvolvedAction} className="mt-3">
          <SubmitButton
            pendingText="生成中…"
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            学習進化型ペルソナを生成する
          </SubmitButton>
        </form>

        {corpusEntries && corpusEntries.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-ink-muted">
              抽出された論点・誤概念・有効な問い({corpusEntries.length}件)
            </summary>
            <ul className="mt-2 space-y-2 text-xs text-ink-muted">
              {(corpusEntries as CorpusEntryRow[]).map((entry) => (
                <li key={entry.id} className="rounded-md border border-line p-2">
                  <p>論点: {entry.topic}</p>
                  {entry.misconception && <p>誤概念: {entry.misconception}</p>}
                  {entry.effective_question && <p>有効な問い: {entry.effective_question}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>



      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
