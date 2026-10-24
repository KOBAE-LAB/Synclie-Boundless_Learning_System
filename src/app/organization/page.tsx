import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { joinOrCreateOrganizationAction, setApproverAction, decideShareRequestAction, decideScopeRequestAction } from "./actions";
import { listPendingScopeRequests } from "@/lib/inquiry/share-scope";
import { SHARE_SCOPE_LABELS } from "@/lib/organizations/scope";
import { ORG_KIND_LABELS, isOrgKind } from "@/lib/organizations/admin";
import { Breadcrumbs } from "@/components/breadcrumbs";

// F21: 組織(学校・地域単位)への参加と、組織をまたぐ共有リクエストの承認者設定。
// SSO(F22)未導入の段階では、教師が組織名を入力して自己申告で参加・作成する。
// 「同一組織はSSOで自動承認、組織を跨ぐ共有は学校ごとに指定した承認者が判断する」
// (要件定義書12章)の「承認者」をこの画面で管理する。

const ITEM_KIND_LABELS: Record<string, string> = {
  persona: "ペルソナ",
  material: "教材(単元の対応表)",
};

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.organization_id) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current="組織" />
      <h1 className="mt-3 text-2xl font-semibold text-ink">組織</h1>
        <p className="mt-1 text-sm text-ink-muted">
          組織(学校・地域単位)に参加すると、同じ組織の教師が共有したペルソナ・教材を
          自動的に複製できるようになる(承認不要)。組織をまたぐ共有には、組織側の承認者の
          判断が必要になる。
        </p>
        <form
          action={joinOrCreateOrganizationAction}
          className="mt-6 space-y-3 rounded-lg border border-line p-5"
        >
          <h2 className="text-sm font-medium text-ink">組織に参加する</h2>
          <label htmlFor="organization-name" className="sr-only">
            組織名
          </label>
          <input
            id="organization-name"
            name="name"
            placeholder="組織名(例: ○○市立△△小学校)"
            required
            className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          />
          <p className="text-xs text-ink-muted">
            既存の組織と同じ名前を入力すれば参加、無ければ新規作成される(作成した場合は自分が
            この組織の承認者になる)。
          </p>
          <button
            type="submit"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
          >
            参加する
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
    "(不明)";

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
      for (const r of requesters ?? []) requesterNames.set(r.id, r.display_name || r.email || "(不明)");
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
      <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current="組織" />
      <h1 className="mt-3 text-2xl font-semibold text-ink">組織</h1>
      <p className="mt-1 text-sm text-ink-muted">
        所属組織: <span className="font-medium text-ink">{org?.name}</span>
      </p>
      <dl className="mt-2 space-y-1 text-sm text-ink-muted">
        <div>
          <dt className="inline">種類: </dt>
          <dd className="inline text-ink">{isOrgKind(org?.kind) ? ORG_KIND_LABELS[org.kind] : "学校"}</dd>
        </div>
        <div>
          <dt className="inline">属する自治体: </dt>
          <dd className="inline text-ink">{parentOrg?.name ?? "(なし)"}</dd>
        </div>
        <div>
          <dt className="inline">連携グループ: </dt>
          <dd className="inline text-ink">{(myNetworks ?? []).map((n) => n.name as string).join("、") || "(なし)"}</dd>
        </div>
        <div>
          <dt className="inline">所属の確認: </dt>
          <dd className={org?.verified ? "inline text-success" : "inline text-warn"}>
            {org?.verified ? "確認済み" : "未確認(先輩のAIを、同じ学校の外へ出すには、管理者の確認が要ります)"}
          </dd>
        </div>
      </dl>
      {error && <p className="mt-3 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-md border border-success px-3 py-2 text-sm text-success">{notice}</p>}

      <div className="mt-6 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">
          共有の承認者: {memberName(org?.approver_teacher_id ?? null)}
          {isApprover && <span className="ml-2 text-xs text-accent">(あなた)</span>}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          組織をまたぐ共有リクエストを判断する人。同じ組織の教師なら誰でも変更できる。
        </p>
        <form action={setApproverAction} className="mt-3 flex items-center gap-2">
          <label htmlFor="approver-id" className="sr-only">
            新しい承認者
          </label>
          <select
            id="approver-id"
            name="approverId"
            defaultValue=""
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
          >
            <option value="" disabled>
              新しい承認者を選択
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
            変更する
          </button>
        </form>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-ink">組織のメンバー({(members ?? []).length}人)</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {(members ?? []).map((m) => (
            <li key={m.id}>{m.display_name || m.email}</li>
          ))}
        </ul>
      </div>

      {isApprover && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">先輩のAIを広げる申請(承認待ち {pendingScopeRequests.length}件)</h2>
          <p className="mt-1 text-xs text-ink-muted">
            同じ学校の外(同じ自治体・連携グループ)の先生にも使えるようにする申請です。承認の前に、内容に学校名や地名が入っていないか、確かめてください。
          </p>
          <ul className="mt-3 space-y-3">
            {pendingScopeRequests.map((r) => (
              <li key={r.personaId} className="rounded-md border border-line px-4 py-3 text-sm">
                <p>
                  <span className="font-medium text-ink">{r.requesterName ?? "(不明)"}</span> さんの「{r.name}」を、
                  <span className="font-medium text-ink">
                    {SHARE_SCOPE_LABELS[r.requested]}{r.networkName ? `(${r.networkName})` : ""}
                  </span>
                  に広げる申請です。
                </p>
                <div className="mt-2 flex gap-2">
                  <form action={decideScopeRequestAction.bind(null, r.personaId, "approved")}>
                    <button type="submit" className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover">
                      承認する
                    </button>
                  </form>
                  <form action={decideScopeRequestAction.bind(null, r.personaId, "declined")}>
                    <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                      見送る
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {pendingScopeRequests.length === 0 && <li className="text-sm text-ink-muted">承認待ちの申請はありません。</li>}
          </ul>
        </div>
      )}

      {isApprover && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">
            組織をまたぐ共有リクエスト(承認待ち {pendingRequests.length}件)
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
                    <span className="font-medium text-ink">
                      {requesterNames.get(request.requester_teacher_id)}
                    </span>{" "}
                    さんが「{itemTitles.get(request.item_id) ?? "(不明)"}」(
                    {ITEM_KIND_LABELS[request.item_kind]})へのアクセスをリクエストしています。
                  </p>
                  <div className="mt-2 flex gap-2">
                    <form action={boundApprove}>
                      <button
                        type="submit"
                        className="rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
                      >
                        承認する
                      </button>
                    </form>
                    <form action={boundDecline}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                      >
                        見送る
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
            {pendingRequests.length === 0 && (
              <li className="text-sm text-ink-muted">承認待ちのリクエストはありません。</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
