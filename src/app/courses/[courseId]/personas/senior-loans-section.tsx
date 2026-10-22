import Link from "next/link";
import type { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { listArchive, listLessonLoans, MAX_LOANS_PER_LESSON, SENIOR_MODE_LABELS, type SeniorMode } from "@/lib/inquiry/senior";
import { addSeniorLoanAction, removeSeniorLoanAction, setSeniorLoanModeAction, setSeniorLoanStatusAction } from "./senior-loan-actions";

// 授業回のペルソナ設定の「先輩の記録から加える」。承認済みの先輩のAI(同じ学校)を、この回の議論に加える。
// 先輩のAIは、発言のたびに先輩の記録(軌跡・いまの話題に近い場面)を読む。当時モードは、後輩のいまの段階までの記録だけを使う。

const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

function ModeSelect({ id, defaultValue }: { id: string; defaultValue: SeniorMode }) {
  return (
    <select id={id} name="mode" defaultValue={defaultValue} className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs">
      {(Object.keys(SENIOR_MODE_LABELS) as SeniorMode[]).map((m) => (
        <option key={m} value={m}>
          {SENIOR_MODE_LABELS[m]}
        </option>
      ))}
    </select>
  );
}

export async function SeniorLoansSection({
  admin,
  courseId,
  teacherId,
  error,
}: {
  admin: ReturnType<typeof createAdminClient>;
  courseId: string;
  teacherId: string;
  error?: string;
}) {
  const [loans, archive] = await Promise.all([listLessonLoans(admin, courseId), listArchive(admin, teacherId)]);
  const loaned = new Set(loans.map((l) => l.personaId));
  const candidates = archive.filter((e) => e.status === "approved" && !loaned.has(e.id));

  return (
    <section id="seniors" className="mt-8 rounded-lg border border-line p-5">
      <h2 className="text-sm font-medium text-ink">
        先輩・前の年度のみんなの記録から加える
        <span className="ml-2 text-xs font-normal text-ink-muted">{loans.length}/{MAX_LOANS_PER_LESSON}人</span>
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        先輩・集約型のAIを、この回に加えます(任意)。作成は<Link href="/archive" className="mx-0.5 underline underline-offset-2">先輩の記録</Link>で行います。
      </p>
      {error && <p className="mt-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <ul className="mt-3 space-y-2">
        {loans.map((l) => (
          <li key={l.loanId} className="rounded-md border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-ink">{l.name}</span>
              <span className={`text-xs ${l.status === "active" && l.personaStatus === "approved" ? "text-success" : "text-warn"}`}>
                {l.personaStatus !== "approved" ? "下書きに戻されたため、話しません" : l.status === "active" ? "使用中" : "休止中"}
              </span>
            </div>
            {l.tier === "aggregate" ? (
              <p className="mt-1 text-xs text-ink-faint">前の年度の多くの学習者の記録のまとめです(当時・振り返りの使い分けはありません)。</p>
            ) : (
              <form action={setSeniorLoanModeAction.bind(null, courseId, l.loanId)} className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor={`mode-${l.loanId}`} className="sr-only">使い方</label>
                <ModeSelect id={`mode-${l.loanId}`} defaultValue={l.mode} />
                <SubmitButton pendingText="保存中…" className={small}>使い方を変える</SubmitButton>
              </form>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <form action={setSeniorLoanStatusAction.bind(null, courseId, l.loanId, l.status === "active" ? "paused" : "active")}>
                <button type="submit" className={small}>{l.status === "active" ? "休止する" : "使用中にする"}</button>
              </form>
              <form action={removeSeniorLoanAction.bind(null, courseId, l.loanId)}>
                <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">この回から外す</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {loans.length < MAX_LOANS_PER_LESSON &&
        (candidates.length > 0 ? (
          <form action={addSeniorLoanAction.bind(null, courseId)} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="senior-pick" className="sr-only">先輩のAI</label>
            <select id="senior-pick" name="personaId" defaultValue="" required className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="" disabled>
                先輩・集約型のAIを選ぶ
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tier === "aggregate" ? "【集約型】" : "【先輩型】"}
                  {c.name}({c.role})
                </option>
              ))}
            </select>
            <label htmlFor="senior-mode" className="sr-only">使い方(先輩型のとき)</label>
            <ModeSelect id="senior-mode" defaultValue="then" />
            <span className="text-xs text-ink-faint">(集約型では使い方は関係ありません)</span>
            <SubmitButton pendingText="加えています…" className={small}>この回に加える</SubmitButton>
          </form>
        ) : (
          <p className="mt-3 text-xs text-ink-faint">加えられる先輩のAIがありません(承認済みのものが選べます)。</p>
        ))}
    </section>
  );
}
