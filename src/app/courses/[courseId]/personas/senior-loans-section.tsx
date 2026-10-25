import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import type { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { listArchive, listLessonLoans, MAX_LOANS_PER_LESSON, type SeniorMode } from "@/lib/inquiry/senior";
import { addSeniorLoanAction, removeSeniorLoanAction, setSeniorLoanModeAction, setSeniorLoanStatusAction } from "./senior-loan-actions";

// 授業回のペルソナ設定の「先輩の記録から加える」。承認済みの先輩のAI(同じ学校)を、この回の議論に加える。
// 先輩のAIは、発言のたびに先輩の記録(軌跡・いまの話題に近い場面)を読む。当時モードは、後輩のいまの段階までの記録だけを使う。

const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

async function ModeSelect({ id, defaultValue }: { id: string; defaultValue: SeniorMode }) {
  const { t } = await getT();
  return (
    <select id={id} name="mode" defaultValue={defaultValue} className="rounded-md border border-line bg-surface-raised px-2 py-1 text-xs">
      {(["then", "retrospective"] as SeniorMode[]).map((m) => (
        <option key={m} value={m}>
          {m === "then" ? t("seniorLoans.modeThen") : t("seniorLoans.modeRetro")}
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
  const { t } = await getT();
  const [loans, archive] = await Promise.all([listLessonLoans(admin, courseId), listArchive(admin, teacherId)]);
  const loaned = new Set(loans.map((l) => l.personaId));
  const candidates = archive.filter((e) => e.status === "approved" && !loaned.has(e.id));

  return (
    <section id="seniors" className="mt-8 rounded-lg border border-line p-5">
      <h2 className="text-sm font-medium text-ink">
        {t("seniorLoans.heading")}
        <span className="ml-2 text-xs font-normal text-ink-muted">{t("seniorLoans.count", { n: loans.length, max: MAX_LOANS_PER_LESSON })}</span>
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        {t("seniorLoans.leadA")}<Link href="/archive" className="mx-0.5 underline underline-offset-2">{t("seniorLoans.leadLink")}</Link>{t("seniorLoans.leadB")}
      </p>
      {error && <p className="mt-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <ul className="mt-3 space-y-2">
        {loans.map((l) => (
          <li key={l.loanId} className="rounded-md border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-ink">
                {l.name}
                {l.scope === "cross_org" && <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-ink-muted ring-1 ring-line">{t("seniorLoans.crossOrg")}</span>}
              </span>
              <span className={`text-xs ${l.status === "active" && l.personaStatus === "approved" ? "text-success" : "text-warn"}`}>
                {l.personaStatus !== "approved" ? t("seniorLoans.draftBack") : l.status === "active" ? t("seniorLoans.inUse") : t("seniorLoans.paused")}
              </span>
            </div>
            {l.tier === "aggregate" ? (
              <p className="mt-1 text-xs text-ink-faint">{t("seniorLoans.aggregateNote")}</p>
            ) : (
              <form action={setSeniorLoanModeAction.bind(null, courseId, l.loanId)} className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor={`mode-${l.loanId}`} className="sr-only">{t("seniorLoans.usage")}</label>
                <ModeSelect id={`mode-${l.loanId}`} defaultValue={l.mode} />
                <SubmitButton pendingText={t("seniorLoans.saving")} className={small}>{t("seniorLoans.changeUsage")}</SubmitButton>
              </form>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <form action={setSeniorLoanStatusAction.bind(null, courseId, l.loanId, l.status === "active" ? "paused" : "active")}>
                <button type="submit" className={small}>{l.status === "active" ? t("seniorLoans.pause") : t("seniorLoans.setActive")}</button>
              </form>
              <form action={removeSeniorLoanAction.bind(null, courseId, l.loanId)}>
                <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">{t("seniorLoans.remove")}</button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {loans.length < MAX_LOANS_PER_LESSON &&
        (candidates.length > 0 ? (
          <form action={addSeniorLoanAction.bind(null, courseId)} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="senior-pick" className="sr-only">{t("seniorLoans.seniorAi")}</label>
            <select id="senior-pick" name="personaId" defaultValue="" required className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm">
              <option value="" disabled>
                {t("seniorLoans.pickPlaceholder")}
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tier === "aggregate" ? t("seniorLoans.tagAggregate") : t("seniorLoans.tagSenior")}
                  {c.name}({c.role}){c.crossOrg ? t("seniorLoans.otherSchool", { org: c.ownerOrgName ? `: ${c.ownerOrgName}` : "" }) : ""}
                </option>
              ))}
            </select>
            <label htmlFor="senior-mode" className="sr-only">{t("seniorLoans.usageSenior")}</label>
            <ModeSelect id="senior-mode" defaultValue="then" />
            <span className="text-xs text-ink-faint">{t("seniorLoans.aggNoUsage")}</span>
            <SubmitButton pendingText={t("seniorLoans.adding")} className={small}>{t("seniorLoans.add")}</SubmitButton>
          </form>
        ) : (
          <p className="mt-3 text-xs text-ink-faint">{t("seniorLoans.none")}</p>
        ))}
    </section>
  );
}
