import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { StepNumber } from "@/components/step-number";
import { listArchive, listSourceProjects, MAX_NICKNAME } from "@/lib/inquiry/senior";
import { listAggregateSources } from "@/lib/inquiry/aggregate";
import { MIN_AGGREGATE_LEARNERS } from "@/lib/inquiry/aggregate-items";
import { personaInitial } from "@/lib/persona-tones";
import {
  createSeniorDraftAction,
  deleteSeniorAction,
  recommendSeniorAvatarAction,
  setSeniorAvatarAction,
  setSeniorStatusAction,
  updateSeniorAction,
  createAggregateDraftAction,
  updateAggregateAction,
  requestScopeAction,
} from "./actions";
import { SHARE_SCOPES, shareScopeLabel } from "@/lib/organizations/scope";
import { getT } from "@/lib/i18n/server";

// 先輩の記録(アーカイブ): 先輩の探究の記録から「先輩のAI」を作り、承認して、同じ学校の授業回で使えるようにする。
// 使うときは、授業回のペルソナ設定の「先輩の記録から加える」で選ぶ(当時モード/振り返りモード)。

const input = "w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm";
const small = "rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t } = await getT();
  const admin = createAdminClient();
  const [entries, projects, aggregateSources, { data: avatarRows }] = await Promise.all([
    listArchive(admin, user.id),
    listSourceProjects(admin, user.id),
    listAggregateSources(admin, user.id),
    admin.from("avatar_options").select("id, label").order("label", { ascending: true }),
  ]);
  // 自分の学校が入っている連携グループ(広げる先の選択肢)
  const { data: myProfile } = await admin.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  const myOrgId = (myProfile?.organization_id as string | null) ?? null;
  const { data: myNetworkLinks } = myOrgId
    ? await admin.from("organization_network_members").select("network_id").eq("organization_id", myOrgId)
    : { data: [] as { network_id: string }[] };
  const networkIds = (myNetworkLinks ?? []).map((n) => n.network_id as string);
  const { data: networkRows } = networkIds.length > 0 ? await admin.from("organization_networks").select("id, name").in("id", networkIds) : { data: [] as { id: string; name: string }[] };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={t("archivePage.title")} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{t("archivePage.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("archivePage.lead")}
      </p>
      {error && <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md border border-success px-3 py-2 text-sm text-success">{notice}</p>}

      <section className="mt-8">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("archivePage.aiHeading", { n: entries.length })}</h2>
        <ul className="mt-3 space-y-3">
          {entries.map((e) => (
            <li key={e.id} id={`persona-${e.id}`} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-3 font-medium text-ink">
                  {e.avatarPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.avatarPath} alt="" className="h-10 w-10 shrink-0 rounded-full border border-line bg-surface object-cover object-top" />
                  ) : (
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-muted">
                      {personaInitial(e.name)}
                    </span>
                  )}
                  {e.name}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-ink-muted ring-1 ring-line">
                    {e.tier === "aggregate" ? t("archivePage.tagAggregate") : t("archivePage.tagSenior")}
                  </span>
                  {e.crossOrg && (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-ink-muted ring-1 ring-line">
                      {t("archivePage.otherSchoolTag", { org: e.ownerOrgName ? `(${e.ownerOrgName})` : "" })}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={e.status === "draft" ? "font-semibold text-warn" : "text-ink-faint"}>
                    <StepNumber n={1} />
                    {t("archivePage.draft")}
                  </span>
                  <span aria-hidden="true" className="text-ink-faint">→</span>
                  <span className={e.status === "approved" ? "font-semibold text-success" : "text-ink-faint"}>
                    <StepNumber n={2} />
                    {t("archivePage.approvedUse")}
                  </span>
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{e.role}</p>
              <dl className="mt-2 space-y-1 text-sm">
                <div>
                  <dt className="inline text-xs text-ink-faint">{e.tier === "aggregate" ? t("archivePage.aggPosition") : t("archivePage.thenPosition")}</dt>
                  <dd className="inline text-ink">{e.position || t("archivePage.unset")}</dd>
                </div>
                <div>
                  <dt className="inline text-xs text-ink-faint">{t("archivePage.approach")}</dt>
                  <dd className="inline text-ink">{e.goal || t("archivePage.unset")}</dd>
                </div>
              </dl>
              {e.tier === "aggregate" && e.itemsText && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink">
                  {e.itemsText.split("\n").map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
              {e.mine ? (
                <>
                  {e.sourceTitle && <p className="mt-2 text-xs text-ink-faint">{t("archivePage.srcProject", { t: e.sourceTitle })}</p>}
                  {e.sourceSeriesTitle && <p className="mt-2 text-xs text-ink-faint">{t("archivePage.srcSeries", { t: e.sourceSeriesTitle })}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-faint">{t("archivePage.avatarLine", { s: e.avatarPath ? t("archivePage.avatarSet") : t("archivePage.avatarUnset") })}</span>
                    <form action={recommendSeniorAvatarAction.bind(null, e.id)}>
                      <SubmitButton pendingText={t("archivePage.recommending")} className={small}>{t("archivePage.recommend")}</SubmitButton>
                    </form>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-muted">{t("archivePage.manualSummary")}</summary>
                    <form action={setSeniorAvatarAction.bind(null, e.id)} className="mt-2 flex flex-wrap items-center gap-2">
                      <label htmlFor={`avatar-${e.id}`} className="sr-only">{t("archivePage.avatarLabel")}</label>
                      <select id={`avatar-${e.id}`} name="avatarId" defaultValue={e.avatarId ?? ""} required className={`${input} max-w-xs`}>
                        <option value="" disabled>{t("archivePage.pickPlease")}</option>
                        {(avatarRows ?? []).map((a) => (
                          <option key={a.id as string} value={a.id as string}>{a.label as string}</option>
                        ))}
                      </select>
                      <SubmitButton pendingText={t("archivePage.saving")} className={small}>{t("archivePage.change")}</SubmitButton>
                    </form>
                  </details>
                  <div className="mt-3 rounded-md border border-line-soft p-3">
                    <p className="text-xs font-medium text-ink">
                      {t("archivePage.scopeLine", { s: shareScopeLabel(t, e.shareScope) })}
                      {e.scopeRequest && (
                        <span className="ml-2 font-normal text-warn">
                          {t("archivePage.scopePending", { s: shareScopeLabel(t, e.scopeRequest) })}
                        </span>
                      )}
                    </p>
                    <form action={requestScopeAction.bind(null, e.id)} className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs text-ink-muted">
                        <span className="block">{t("archivePage.changeTo")}</span>
                        <select name="scope" defaultValue={e.shareScope} className={`${input} mt-1 w-auto`}>
                          {SHARE_SCOPES.map((sc) => (
                            <option key={sc} value={sc}>{shareScopeLabel(t, sc)}</option>
                          ))}
                        </select>
                      </label>
                      {(networkRows ?? []).length > 0 && (
                        <label className="text-xs text-ink-muted">
                          <span className="block">{t("archivePage.networkLabel")}</span>
                          <select name="networkId" defaultValue={e.shareNetworkId ?? ""} className={`${input} mt-1 w-auto`}>
                            <option value="">{t("archivePage.noPick")}</option>
                            {(networkRows ?? []).map((n) => (
                              <option key={n.id as string} value={n.id as string}>{n.name as string}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      <SubmitButton pendingText={t("archivePage.sending")} className={small}>{t("archivePage.applyScope")}</SubmitButton>
                    </form>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink-muted">{t("archivePage.rulesSummary")}</summary>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                        <li>{t("archivePage.rule1")}</li>
                        <li>{t("archivePage.rule2")}</li>
                        <li>{t("archivePage.rule3")}</li>
                        <li>{t("archivePage.rule4")}</li>
                        <li>{t("archivePage.rule5")}</li>
                      </ul>
                    </details>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-ink-muted">{t("archivePage.editSummary")}</summary>
                    <form action={(e.tier === "aggregate" ? updateAggregateAction : updateSeniorAction).bind(null, e.id)} className="mt-2 space-y-2">
                      <label className="block text-xs text-ink-muted">
                        {e.tier === "aggregate" ? t("archivePage.nickAgg") : t("archivePage.nickSenior")}
                        <input name="nickname" defaultValue={e.nickname ?? ""} required={e.tier !== "aggregate"} maxLength={MAX_NICKNAME} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        {t("archivePage.role")}
                        <input name="role" defaultValue={e.role} maxLength={80} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        {t("archivePage.tone")}
                        <input name="tone" defaultValue={e.tone} maxLength={80} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        {e.tier === "aggregate" ? t("archivePage.viewAgg") : t("archivePage.thenQ")}
                        <textarea name="position" defaultValue={e.position} maxLength={300} rows={2} className={input} />
                      </label>
                      <label className="block text-xs text-ink-muted">
                        {t("archivePage.approachLabel")}
                        <textarea name="goal" defaultValue={e.goal} maxLength={300} rows={2} className={input} />
                      </label>
                      {e.tier === "aggregate" && (
                        <label className="block text-xs text-ink-muted">
                          {t("archivePage.items")}
                          <textarea name="items" defaultValue={e.itemsText} rows={6} className={input} />
                        </label>
                      )}
                      <SubmitButton pendingText={t("archivePage.saving")} className={small}>{t("archivePage.save")}</SubmitButton>
                    </form>
                  </details>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {e.status === "draft" ? (
                      <form action={setSeniorStatusAction.bind(null, e.id, "approved")}>
                        <button type="submit" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover">
                          {t("archivePage.nextApprove")}
                        </button>
                      </form>
                    ) : (
                      <form action={setSeniorStatusAction.bind(null, e.id, "draft")}>
                        <button type="submit" className={small}>{t("archivePage.backDraft")}</button>
                      </form>
                    )}
                    <form action={deleteSeniorAction.bind(null, e.id)}>
                      <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">{t("archivePage.delete")}</button>
                    </form>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">{t("archivePage.othersMade")}</p>
              )}
            </li>
          ))}
          {entries.length === 0 && <li className="text-sm text-ink-muted">{t("archivePage.noAi")}</li>}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("archivePage.makeHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {t("archivePage.makeLead")}
        </p>
        <ul className="mt-3 space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-ink">
                  {p.title}
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    {p.fiscalYear ? t("archivePage.fyPart", { y: p.fiscalYear }) : ""}
                    {p.kind === "group" ? t("archivePage.kindGroup") : t("archivePage.kindSolo")}
                    {p.seriesLabel ? `・${p.seriesLabel}` : ""}
                    {p.hasRetrospective ? t("archivePage.finished") : t("archivePage.inProgress")}
                  </span>
                </span>
                {p.seniorCount > 0 && <span className="text-xs text-ink-faint">{t("archivePage.seniorCount", { n: p.seniorCount })}</span>}
              </div>
              {p.theme && <p className="mt-1 text-xs text-ink-muted">{t("archivePage.themeLine", { t: p.theme })}</p>}
              <form action={createSeniorDraftAction.bind(null, p.id)} className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor={`nick-${p.id}`} className="sr-only">{t("archivePage.nickLabel")}</label>
                <input
                  id={`nick-${p.id}`}
                  name="nickname"
                  required
                  maxLength={MAX_NICKNAME}
                  placeholder={t("archivePage.nickPlaceholder")}
                  className="w-40 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
                />
                <SubmitButton pendingText={t("archivePage.makingDraft")} className={small}>{t("archivePage.makeDraft")}</SubmitButton>
              </form>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="text-sm text-ink-muted">
              {t("archivePage.noProjects")}
            </li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="border-b border-line-soft pb-2 text-base font-semibold text-ink">{t("archivePage.aggHeading")}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {t("archivePage.aggLead")}
        </p>
        <ul className="mt-3 space-y-2">
          {aggregateSources.map((s) => (
            <li key={s.seriesId} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-ink">
                  {s.title}
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    {s.fiscalYear ? t("archivePage.fyPart", { y: s.fiscalYear }) : ""}{t("archivePage.learnersAgreed", { n: s.learnerCount, ended: s.archived ? t("archivePage.endedPart") : "" })}
                  </span>
                </span>
                {s.aggregateCount > 0 && <span className="text-xs text-ink-faint">{t("archivePage.aggCount", { n: s.aggregateCount })}</span>}
              </div>
              {s.learnerCount >= MIN_AGGREGATE_LEARNERS ? (
                <form action={createAggregateDraftAction.bind(null, s.seriesId)} className="mt-2 flex flex-wrap items-center gap-2">
                  <label htmlFor={`agg-nick-${s.seriesId}`} className="sr-only">{t("archivePage.nickOpt")}</label>
                  <input id={`agg-nick-${s.seriesId}`} name="nickname" maxLength={MAX_NICKNAME} placeholder={t("archivePage.nickOptPlaceholder")} className="w-48 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm" />
                  <SubmitButton pendingText={t("archivePage.creating")} className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                    {t("archivePage.makeAgg")}
                  </SubmitButton>
                </form>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">{t("archivePage.notEnough", { n: MIN_AGGREGATE_LEARNERS })}</p>
              )}
            </li>
          ))}
          {aggregateSources.length === 0 && <li className="text-sm text-ink-muted">{t("archivePage.noSources")}</li>}
        </ul>
      </section>

      <BackLink href="/courses" label={t("lessonCrumbs.courseList")} />
    </div>
  );
}
