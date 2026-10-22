import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { StepNumber } from "@/components/step-number";
import { listArchive, listSourceProjects, MAX_NICKNAME } from "@/lib/inquiry/senior";
import { createSeniorDraftAction, deleteSeniorAction, setSeniorStatusAction, updateSeniorAction } from "./actions";

// 先輩の記録(アーカイブ): 先輩の探究の記録から「先輩のAI」を作り、承認して、同じ学校の授業回で使えるようにする。
// 使うときは、授業回のペルソナ設定の「先輩の記録から加える」で選ぶ(当時モード/振り返りモード)。

const input = "w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm";
const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  const [entries, projects] = await Promise.all([listArchive(admin, user.id), listSourceProjects(admin, user.id)]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current="先輩の記録" />
      <h1 className="mt-3 text-2xl font-semibold text-ink">先輩の記録</h1>
      <p className="mt-1 text-sm text-ink-muted">
        先輩の探究の記録から「先輩のAI」を作ります。承認すると、同じ学校の先生が、授業回のペルソナ設定で後輩の議論に加えられます。
      </p>
      {error && <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <section className="mt-8">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">先輩のAI({entries.length})</h2>
        <ul className="mt-3 space-y-3">
          {entries.map((e) => (
            <li key={e.id} id={`persona-${e.id}`} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{e.name}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={e.status === "draft" ? "font-semibold text-warn" : "text-ink-faint"}>
                    <StepNumber n={1} />
                    下書き
                  </span>
                  <span aria-hidden="true" className="text-ink-faint">→</span>
                  <span className={e.status === "approved" ? "font-semibold text-success" : "text-ink-faint"}>
                    <StepNumber n={2} />
                    承認済み(授業回で使える)
                  </span>
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{e.role}</p>
              <dl className="mt-2 space-y-1 text-sm">
                <div>
                  <dt className="inline text-xs text-ink-faint">当時の問い: </dt>
                  <dd className="inline text-ink">{e.position || "(未設定)"}</dd>
                </div>
                <div>
                  <dt className="inline text-xs text-ink-faint">後輩との関わり方: </dt>
                  <dd className="inline text-ink">{e.goal || "(未設定)"}</dd>
                </div>
              </dl>
              {e.mine ? (
                <>
                  {e.sourceTitle && <p className="mt-2 text-xs text-ink-faint">材料: 探究プロジェクト「{e.sourceTitle}」</p>}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-ink-muted">内容を確認・修正する</summary>
                    <form action={updateSeniorAction.bind(null, e.id)} className="mt-2 space-y-2">
                      <label className="block text-xs text-ink-muted">
                        呼び名(名前は「年度の先輩 呼び名(AI)」になります)
                        <input name="nickname" defaultValue={e.nickname ?? ""} required maxLength={MAX_NICKNAME} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        役割
                        <input name="role" defaultValue={e.role} maxLength={80} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        口調
                        <input name="tone" defaultValue={e.tone} maxLength={80} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        当時の問い・考え
                        <textarea name="position" defaultValue={e.position} maxLength={300} rows={2} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        後輩との関わり方
                        <textarea name="goal" defaultValue={e.goal} maxLength={300} rows={2} className={input} />
                      </label>
                      <SubmitButton pendingText="保存中…" className={small}>保存</SubmitButton>
                    </form>
                  </details>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {e.status === "draft" ? (
                      <form action={setSeniorStatusAction.bind(null, e.id, "approved")}>
                        <button type="submit" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover">
                          次へ: 承認する
                        </button>
                      </form>
                    ) : (
                      <form action={setSeniorStatusAction.bind(null, e.id, "draft")}>
                        <button type="submit" className={small}>下書きに戻す(授業回でも話さなくなります)</button>
                      </form>
                    )}
                    <form action={deleteSeniorAction.bind(null, e.id)}>
                      <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">削除する</button>
                    </form>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">同じ学校の先生が作った先輩のAIです(使うことができます)。</p>
              )}
            </li>
          ))}
          {entries.length === 0 && <li className="text-sm text-ink-muted">まだ先輩のAIはありません。下の記録から作れます。</li>}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">記録から先輩のAIを作る</h2>
        <p className="mt-2 text-sm text-ink-muted">
          あなたの教科・科目の探究で、記録(軌跡)ができているものです。呼び名を決めると、AIが役割・口調・当時の問いの下書きを作ります。
          データの利用に同意している学習者の記録だけを使います。
        </p>
        <ul className="mt-3 space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-ink">
                  {p.title}
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    {p.fiscalYear ? `${p.fiscalYear}年度・` : ""}
                    {p.kind === "group" ? "グループ" : "個人"}
                    {p.seriesLabel ? `・${p.seriesLabel}` : ""}
                    {p.hasRetrospective ? "・探究を終えた" : "・探究の途中"}
                  </span>
                </span>
                {p.seniorCount > 0 && <span className="text-xs text-ink-faint">先輩のAI {p.seniorCount}人</span>}
              </div>
              {p.theme && <p className="mt-1 text-xs text-ink-muted">テーマ: {p.theme}</p>}
              <form action={createSeniorDraftAction.bind(null, p.id)} className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor={`nick-${p.id}`} className="sr-only">呼び名</label>
                <input
                  id={`nick-${p.id}`}
                  name="nickname"
                  required
                  maxLength={MAX_NICKNAME}
                  placeholder="呼び名(例: ミナト)"
                  className="w-40 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
                />
                <SubmitButton pendingText="下書きを作成中…" className={small}>先輩のAIの下書きを作る</SubmitButton>
              </form>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="text-sm text-ink-muted">
              まだ記録ができた探究はありません。探究の段階が進むか、教科・科目をアーカイブ(探究の終了)すると作られます。
            </li>
          )}
        </ul>
      </section>

      <BackLink href="/courses" label="教科・科目一覧" />
    </div>
  );
}
