import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { orgKindLabel, ORG_KINDS, isOrgKind } from "@/lib/organizations/admin";
import {
  addNetworkMemberAction,
  createMunicipalityAction,
  createNetworkAction,
  deleteNetworkAction,
  removeNetworkMemberAction,
  updateOrganizationAction,
} from "./actions";

// 管理者専用: 組織の種類(学校・自治体)・親の自治体・所属の確認と、連携グループ。
// 先輩のAIを、同じ学校の外(同じ自治体・連携グループ)へ出すときの土台になる。
export default async function AdminOrganizationsPage() {
  await requireAdmin();
  const { t } = await getT();
  const admin = createAdminClient();
  const [{ data: orgs }, { data: networks }, { data: members }, { data: teachers }] = await Promise.all([
    admin.from("organizations").select("id, name, kind, parent_organization_id, verified, sso_tenant_id").order("name", { ascending: true }),
    admin.from("organization_networks").select("id, name").order("name", { ascending: true }),
    admin.from("organization_network_members").select("network_id, organization_id"),
    admin.from("profiles").select("organization_id").eq("role", "teacher").not("organization_id", "is", null),
  ]);
  const orgList = orgs ?? [];
  const nameOf = new Map(orgList.map((o) => [o.id as string, o.name as string]));
  const municipalities = orgList.filter((o) => o.kind === "municipality");
  const teacherCount = new Map<string, number>();
  for (const t of teachers ?? []) teacherCount.set(t.organization_id as string, (teacherCount.get(t.organization_id as string) ?? 0) + 1);

  const inputClass = "rounded-md border border-line bg-surface-raised px-2 py-1.5 text-sm";
  const btnClass = "rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={t("adminOrgs.title")} />
      <h1 className="text-2xl font-semibold text-ink">{t("adminOrgs.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("adminOrgs.lead")}</p>

      <section className="mt-8" aria-labelledby="orgs-h">
        <h2 id="orgs-h" className="text-base font-semibold text-ink">{t("adminOrgs.orgsHeading", { n: orgList.length })}</h2>
        <details className="mt-2 text-sm text-ink-muted">
          <summary className="cursor-pointer underline underline-offset-2">{t("adminOrgs.whatVerified")}</summary>
          <p className="mt-2">
            {t("adminOrgs.verifiedExplain")}
          </p>
        </details>
        <ul className="mt-3 space-y-3">
          {orgList.map((o) => {
            const kind = isOrgKind(o.kind) ? o.kind : "school";
            return (
              <li key={o.id as string} className="rounded-md border border-line p-4 text-sm">
                <p className="font-medium text-ink">
                  {o.name as string}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {t("adminOrgs.teacherCount", { n: teacherCount.get(o.id as string) ?? 0, src: o.sso_tenant_id ? t("adminOrgs.fromLogin") : "" })}
                  </span>
                </p>
                <form action={updateOrganizationAction.bind(null, o.id as string)} className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                  <label className="text-xs text-ink-muted">
                    <span className="block">{t("adminOrgs.kind")}</span>
                    <select name="kind" defaultValue={kind} className={`${inputClass} mt-1`}>
                      {ORG_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {orgKindLabel(t, k)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-ink-muted">
                    <span className="block">{t("adminOrgs.parent")}</span>
                    <select name="parentId" defaultValue={(o.parent_organization_id as string | null) ?? ""} className={`${inputClass} mt-1`}>
                      <option value="">{t("adminOrgs.none")}</option>
                      {municipalities
                        .filter((m) => m.id !== o.id)
                        .map((m) => (
                          <option key={m.id as string} value={m.id as string}>
                            {m.name as string}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" name="verified" defaultChecked={Boolean(o.verified)} />
                    {t("adminOrgs.verified")}
                  </label>
                  <SubmitButton pendingText={t("adminOrgs.saving")} className={btnClass}>
                    {t("adminOrgs.save")}
                  </SubmitButton>
                </form>
              </li>
            );
          })}
          {orgList.length === 0 && <li className="text-sm text-ink-muted">{t("adminOrgs.noOrgs")}</li>}
        </ul>

        <form action={createMunicipalityAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            <span className="block">{t("adminOrgs.makeMuni")}</span>
            <input name="name" required maxLength={60} placeholder={t("adminOrgs.muniPlaceholder")} className={`${inputClass} mt-1 w-56`} />
          </label>
          <SubmitButton pendingText={t("adminOrgs.creating")} className={btnClass}>
            {t("adminOrgs.make")}
          </SubmitButton>
        </form>
      </section>

      <section className="mt-12" aria-labelledby="networks-h">
        <h2 id="networks-h" className="text-base font-semibold text-ink">{t("adminOrgs.networksHeading", { n: (networks ?? []).length })}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t("adminOrgs.networksLead")}</p>
        <ul className="mt-3 space-y-3">
          {(networks ?? []).map((n) => {
            const memberIds = (members ?? []).filter((m) => m.network_id === n.id).map((m) => m.organization_id as string);
            const candidates = orgList.filter((o) => !memberIds.includes(o.id as string));
            return (
              <li key={n.id as string} className="rounded-md border border-line p-4 text-sm">
                <p className="font-medium text-ink">{n.name as string}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {memberIds.map((id) => (
                    <li key={id} className="flex items-center gap-2 rounded-md border border-line-soft px-2 py-1 text-xs text-ink">
                      {nameOf.get(id) ?? t("adminOrgs.unknown")}
                      <form action={removeNetworkMemberAction.bind(null, n.id as string, id)}>
                        <button type="submit" className="text-ink-muted underline underline-offset-2">
                          {t("adminOrgs.remove")}
                        </button>
                      </form>
                    </li>
                  ))}
                  {memberIds.length === 0 && <li className="text-xs text-ink-muted">{t("adminOrgs.noMembers")}</li>}
                </ul>
                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <form action={addNetworkMemberAction.bind(null, n.id as string)} className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-ink-muted">
                      <span className="block">{t("adminOrgs.addOrg")}</span>
                      <select name="organizationId" className={`${inputClass} mt-1`} defaultValue="">
                        <option value="" disabled>
                          {t("adminOrgs.pick")}
                        </option>
                        {candidates.map((o) => (
                          <option key={o.id as string} value={o.id as string}>
                            {o.name as string}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton pendingText={t("adminOrgs.adding")} className={btnClass}>
                      {t("adminOrgs.add")}
                    </SubmitButton>
                  </form>
                  <form action={deleteNetworkAction.bind(null, n.id as string)}>
                    <button type="submit" className="text-xs text-danger underline underline-offset-2">
                      {t("adminOrgs.deleteNetwork")}
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        <form action={createNetworkAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            <span className="block">{t("adminOrgs.makeNetwork")}</span>
            <input name="name" required maxLength={60} placeholder={t("adminOrgs.networkPlaceholder")} className={`${inputClass} mt-1 w-64`} />
          </label>
          <SubmitButton pendingText={t("adminOrgs.creating")} className={btnClass}>
            {t("adminOrgs.make")}
          </SubmitButton>
        </form>
      </section>

      <BackLink href="/courses" label={t("lessonCrumbs.courseList")} />
    </div>
  );
}
