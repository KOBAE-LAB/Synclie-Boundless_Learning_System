import { SubmitButton } from "@/components/submit-button";
import type { createAdminClient } from "@/lib/supabase/server";
import { loadSeriesGroups } from "@/lib/inquiry/groups";
import { loadSoloThemes } from "@/lib/inquiry/solo";
import {
  assignMemberAction,
  createGroupAction,
  deleteGroupAction,
  regenerateGroupCodeAction,
  removeMemberAction,
  renameGroupAction,
} from "./group-actions";

// 探究学習モードの「グループ」と「個人の探究」(教師の画面)。グループを作り、メンバーを割り当てるか、グループのコードを伝えて学習者に入ってもらう。
// テーマはグループが決めて更新する(先生は履歴を見られる)。

const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

export async function GroupsSection({
  admin,
  seriesId,
  archived,
  enrolledStudentIds,
  nameOf,
  error,
}: {
  admin: ReturnType<typeof createAdminClient>;
  seriesId: string;
  archived: boolean;
  enrolledStudentIds: string[];
  nameOf: (studentId: string) => string;
  error?: string;
}) {
  const groups = await loadSeriesGroups(admin, seriesId);
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.studentId)));
  const ungrouped = enrolledStudentIds.filter((id) => !grouped.has(id));
  const soloThemes = await loadSoloThemes(admin, seriesId);
  const dateFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

  return (
    <section id="groups" className="mt-10">
      <h2 className="border-b border-line pb-2 text-base font-semibold text-ink">グループ({groups.length})</h2>
      <p className="mt-2 text-sm text-ink-muted">
        グループに入った学習者は、グループごとに1つの議論を時間差で進めます(メンバーを割り当てるか、グループのコードを伝えて入ってもらいます。1人1グループ)。
        グループに入らない学習者は、一人で探究します。グループは、作らなくても構いません。
      </p>
      {error && <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {ungrouped.length > 0 && (
        <div className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
          <p className="font-medium text-ink">一人で探究している学習者({ungrouped.length}人)</p>
          <ul className="mt-1 space-y-0.5">
            {ungrouped.map((id) => (
              <li key={id}>
                {nameOf(id)}
                <span className="ml-2 text-xs text-ink-faint">{soloThemes.get(id) ? `テーマ: ${soloThemes.get(id)}` : "テーマはまだ決まっていません"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {groups.map((g) => (
          <li key={g.id} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-ink">
                {g.title}
                <span className="ml-2 text-xs font-normal text-ink-muted">{g.members.length}人</span>
              </span>
              {g.joinCode && (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-muted">グループのコード</span>
                  <span className="rounded-md border border-line bg-surface-raised px-2 py-0.5 font-mono tracking-widest text-ink">{g.joinCode}</span>
                  {!archived && (
                    <form action={regenerateGroupCodeAction.bind(null, seriesId, g.id)}>
                      <button type="submit" className="text-xs text-ink-faint hover:underline">再発行</button>
                    </form>
                  )}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-muted">テーマ: {g.theme ? <span className="text-ink">{g.theme}</span> : "(まだ決まっていません)"}</p>

            <ul className="mt-2 space-y-1">
              {g.members.map((m) => (
                <li key={m.studentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="text-ink-muted">{nameOf(m.studentId)}</span>
                  {!archived && (
                    <form action={removeMemberAction.bind(null, seriesId, g.id, m.studentId)}>
                      <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">グループから外す</button>
                    </form>
                  )}
                </li>
              ))}
              {g.members.length === 0 && <li className="text-sm text-ink-faint">まだメンバーがいません。</li>}
            </ul>

            {!archived && enrolledStudentIds.length > 0 && (
              <form action={assignMemberAction.bind(null, seriesId, g.id)} className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor={`assign-${g.id}`} className="sr-only">割り当てる学習者</label>
                <select id={`assign-${g.id}`} name="studentId" defaultValue="" className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
                  <option value="" disabled>学習者を選ぶ(ほかのグループからは移ります)</option>
                  {enrolledStudentIds
                    .filter((id) => !g.members.some((m) => m.studentId === id))
                    .map((id) => (
                      <option key={id} value={id}>
                        {nameOf(id)}{grouped.has(id) ? "(別のグループから移る)" : ""}
                      </option>
                    ))}
                </select>
                <SubmitButton pendingText="割り当て中…" className={small}>割り当てる</SubmitButton>
              </form>
            )}

            {g.themeHistory.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-ink-muted">テーマの変化({g.themeHistory.length})</summary>
                <ol className="mt-2 space-y-1 text-sm">
                  {g.themeHistory.map((h, i) => (
                    <li key={i} className="text-ink-muted">
                      <span className="text-xs text-ink-faint">{dateFmt.format(new Date(h.createdAt))} {h.changedBy ? nameOf(h.changedBy) : ""}</span>
                      <span className="ml-2 text-ink">{h.theme}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {!archived && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-muted">名前を変える・グループを消す</summary>
                <form action={renameGroupAction.bind(null, seriesId, g.id)} className="mt-2 flex flex-wrap gap-2">
                  <label htmlFor={`rename-${g.id}`} className="sr-only">グループの名前</label>
                  <input id={`rename-${g.id}`} name="title" defaultValue={g.title} required maxLength={40} className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
                  <SubmitButton pendingText="保存中…" className={small}>保存</SubmitButton>
                </form>
                <form action={deleteGroupAction.bind(null, seriesId, g.id)} className="mt-2">
                  <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">
                    このグループを消す(議論の記録が無いときだけ)
                  </button>
                </form>
              </details>
            )}
          </li>
        ))}
        {groups.length === 0 && <li className="text-sm text-ink-muted">まだグループがありません。</li>}
      </ul>

      {!archived && (
        <form action={createGroupAction.bind(null, seriesId)} className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor="group-new-title" className="sr-only">新しいグループの名前</label>
          <input id="group-new-title" name="title" required maxLength={40} placeholder="新しいグループの名前(例: 防災班)" className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm" />
          <SubmitButton pendingText="作成中…" className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
            グループを作る
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
