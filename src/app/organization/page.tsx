import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { joinOrCreateOrganizationAction, setApproverAction, decideShareRequestAction, decideScopeRequestAction } from "./actions";
import { listPendingScopeRequests } from "@/lib/inquiry/share-scope";
import { shareScopeLabel } from "@/lib/organizations/scope";
import { getT } from "@/lib/i18n/server";
import { orgKindLabel, isOrgKind } from "@/lib/organizations/admin";
import { Breadcrumbs } from "@/components/breadcrumbs";

// F21: 組織(学校・地域単位)への参加と、組織をまたぐ共有リクエストの承認者設定。
// SSO(F22)未導入の段階では、教師が組織名を入力して自己申告で参加・作成する。
// 「同一組織はSSOで自動承認、組織を跨ぐ共有は学校ごとに指定した承認者が判断する」
// (要件定義書12章)の「承認者」をこの画面で管理する。

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t } = await getT();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.organization_id) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={t("orgPage.title")} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{t("orgPage.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("orgPage.noOrgLead")}
        </p>
        <form
          action={joinOrCreateOrganizationAction}
          className="mt-6 space-y-3 rounded-lg border border-line p-5"
        >
          <h2 className="text-sm font-medium text-ink">{t("orgPage.joinHeading")}</h2>
          <label htmlFor="organization-name" className="sr-only">
            {t("orgPage.orgNameLabel")}
          </label>
          <input
            id="organization-name"
            name="name"
            placeholder={t("orgPage.orgNamePlaceholder")}
            required
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <p className="text-xs text-ink-muted">
            {t("orgPage.joinNote")}
          </p>
          <button
            type="submit"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            {t("orgPage.join")}
          </button>
        </form>
      </div>
    );
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, approver_teacher_id, kind, parent_organization_id, verified")
    .eq("id", profile.organization_id)
    .maybeSingle();

  const { data: members } = await admin
    .from("profiles")
    .select("id, display_name, email")
    .eq("organization_id", profile.organization_id)
    .eq("role", "teacher")
    .order("display_name", { ascending: true });

  const memberName = (id: string | null) =>
    (members ?? []).find((m) => m.id === id)?.display_name ??
    (members ?? []).find((m) => m.id === id)?.email ??
    t("orgPage.unknown");

  const isApprover = org?.approver_teacher_id === user.id;
  const { data: parentOrg } = org?.parent_organization_id
    ? await admin.from("organizations").select("name").eq("id", org.parent_organization_id).maybeSingle()
    : { data: null };
  const { data: myNetworkLinks } = await admin.from("organization_network_members").select("network_id").eq("organization_id", profile.organization_id);
  const myNetworkIds = (myNetworkLinks ?? []).map((n) => n.network_id as string);
  const { data: myNetworks } = myNetworkIds.length > 0 ? await admin.from("organization_networks").select("name").in("id", myNetworkIds) : { data: [] as { name: string }[] };
  const pendingScopeRequests = isApprover ? await listPendingScopeRequests(admin, user.id) : [];

  let pendingRequests: {
    id: string;
    requester_teacher_id: string;
    item_kind: string;
    item_id: string;
    created_at: string;
  }[] = [];
  const requesterNames = new Map<string, string>();
  const itemTitles = new Map<string, string>();

  if (isApprover) {
    const { data: requests } = await admin
      .from("share_requests")
      .select("id, requester_teacher_id, item_kind, item_id, created_at")
      .eq("owner_organization_id", org!.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    pendingRequests = requests ?? [];

    const requesterIds = [...new Set(pendingRequests.map((r) => r.requester_teacher_id))];
    if (requesterIds.length > 0) {
      const { data: requesters } = await admin
        .from("profiles")
        .select("id, display_name, email")
        .in("id", requesterIds);
      for (const r of requesters ?? []) requesterNames.set(r.id, r.display_name || r.email || t("orgPage.unknown"));
    }

    const personaIds = pendingRequests.filter((r) => r.item_kind === "persona").map((r) => r.item_id);
    const materialIds = pendingRequests.filter((r) => r.item_kind === "material").map((r) => r.item_id);
    if (personaIds.length > 0) {
      const { data: personas } = await admin.from("personas").select("id, name").in("id", personaIds);
      for (const p of personas ?? []) itemTitles.set(p.id, p.name);
    }
    if (materialIds.length > 0) {
      const { data: materials } = await admin.from("course_materials").select("id, title").in("id", materialIds);
      for (const m of materials ?? []) itemTitles.set(m.id, m.title);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={t("orgPage.title")} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{t("orgPage.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("orgPage.myOrg")}<span className="font-medium text-ink">{org?.name}</span>
      </p>
      <dl className="mt-2 space-y-1 text-sm text-ink-muted">
        <div>
          <dt className="inline">{t("orgPage.kindLabel")}</dt>
          <dd className="inline text-ink">{isOrgKind(org?.kind) ? orgKindLabel(t, org.kind) : t("orgEnums.kind_school")}</dd>
        </div>
        <div>
          <dt className="inline">{t("orgPage.parentLabel")}</dt>
          <dd className="inline text-ink">{parentOrg?.name ?? t("orgPage.none")}</dd>
        </div>
        <div>
          <dt className="inline">{t("orgPage.networkLabel")}</dt>
          <dd className="inline text-ink">{(myNetworks ?? []).map((n) => n.name as string).join("、") || t("orgPage.none")}</dd>
        </div>
        <div>
          <dt className="inline">{t("orgPage.verifiedLabel")}</dt>
          <dd className={org?.verified ? "inline text-success" : "inline text-warn"}>
            {org?.verified ? t("orgPage.verified") : t("orgPage.unverified")}
          </dd>
        </div>
      </dl>
      {error && <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md border border-success px-3 py-2 text-sm text-success">{notice}</p>}

      <div className="mt-6 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">
          {t("orgPage.approver", { name: memberName(org?.approver_teacher_id ?? null) })}
          {isApprover && <span className="ml-2 text-xs text-accent">{t("orgPage.you")}</span>}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          {t("orgPage.approverLead")}
        </p>
        <form action={setApproverAction} className="mt-3 flex items-center gap-2">
          <label htmlFor="approver-id" className="sr-only">
            {t("orgPage.newApprover")}
          </label>
          <select
            id="approver-id"
            name="approverId"
            defaultValue=""
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          >
            <option value="" disabled>
              {t("orgPage.pickApprover")}
            </option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name || m.email}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="shrink-0 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-surface"
          >
            {t("orgPage.change")}
          </button>
        </form>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-ink">{t("orgPage.members", { n: (members ?? []).length })}</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {(members ?? []).map((m) => (
            <li key={m.id}>{m.display_name || m.email}</li>
          ))}
        </ul>
      </div>

      {isApprover && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">{t("orgPage.scopeHeading", { n: pendingScopeRequests.length })}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {t("orgPage.scopeLead")}
          </p>
          <ul className="mt-3 space-y-3">
            {pendingScopeRequests.map((r) => (
              <li key={r.personaId} className="rounded-md border border-line px-4 py-3 text-sm">
                <p>
                  {t("orgPage.scopeReq", { who: r.requesterName ?? t("orgPage.unknown"), name: r.name, scope: shareScopeLabel(t, r.requested) + (r.networkName ? `(${r.networkName})` : "") })}
                </p>
                <div className="mt-2 flex gap-2">
                  <form action={decideScopeRequestAction.bind(null, r.personaId, "approved")}>
                    <button type="submit" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover">
                      {t("orgPage.approve")}
                    </button>
                  </form>
                  <form action={decideScopeRequestAction.bind(null, r.personaId, "declined")}>
                    <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                      {t("orgPage.decline")}
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {pendingScopeRequests.length === 0 && <li className="text-sm text-ink-muted">{t("orgPage.noScopeReq")}</li>}
          </ul>
        </div>
      )}

      {isApprover && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">
            {t("orgPage.shareHeading", { n: pendingRequests.length })}
          </h2>
          <ul className="mt-3 space-y-3">
            {pendingRequests.map((request) => {
              const boundApprove = decideShareRequestAction.bind(null, request.id, "approved");
              const boundDecline = decideShareRequestAction.bind(null, request.id, "declined");
              return (
                <li
                  key={request.id}
                  className="rounded-md border border-line px-4 py-3 text-sm"
                >
                  <p>
                    {t("orgPage.accessReq", { who: requesterNames.get(request.requester_teacher_id) ?? "", item: itemTitles.get(request.item_id) ?? t("orgPage.unknown"), kind: request.item_kind === "persona" ? t("orgPage.itemPersona") : t("orgPage.itemMaterial") })}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <form action={boundApprove}>
                      <button
                        type="submit"
                        className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
                      >
                        {t("orgPage.approve")}
                      </button>
                    </form>
                    <form action={boundDecline}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                      >
                        {t("orgPage.decline")}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
            {pendingRequests.length === 0 && (
              <li className="text-sm text-ink-muted">{t("orgPage.noShareReq")}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
