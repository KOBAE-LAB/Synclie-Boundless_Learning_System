import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { ORG_KIND_LABELS, ORG_KINDS, isOrgKind } from "@/lib/organizations/admin";
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
      <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current="組織の管理" />
      <h1 className="text-2xl font-semibold text-ink">組織の管理</h1>
      <p className="mt-1 text-sm text-ink-muted">先輩のAIを、同じ学校の外へ出すための設定です。</p>

      <section className="mt-8" aria-labelledby="orgs-h">
        <h2 id="orgs-h" className="text-base font-semibold text-ink">組織({orgList.length})</h2>
        <details className="mt-2 text-sm text-ink-muted">
          <summary className="cursor-pointer underline underline-offset-2">所属の確認とは</summary>
          <p className="mt-2">
            先生が組織名を入力して入った組織は、名前だけで入れるため、確かな所属ではありません。確かだと確かめた組織(Googleなどのログインで作られた組織を含む)だけが、
            先輩のAIを広い範囲に出せます。
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
                    先生{teacherCount.get(o.id as string) ?? 0}人{o.sso_tenant_id ? "・ログインの組織から作成" : ""}
                  </span>
                </p>
                <form action={updateOrganizationAction.bind(null, o.id as string)} className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                  <label className="text-xs text-ink-muted">
                    <span className="block">種類</span>
                    <select name="kind" defaultValue={kind} className={`${inputClass} mt-1`}>
                      {ORG_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {ORG_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-ink-muted">
                    <span className="block">属する自治体</span>
                    <select name="parentId" defaultValue={(o.parent_organization_id as string | null) ?? ""} className={`${inputClass} mt-1`}>
                      <option value="">(なし)</option>
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
                    所属を確かめた
                  </label>
                  <SubmitButton pendingText="保存中…" className={btnClass}>
                    保存する
                  </SubmitButton>
                </form>
              </li>
            );
          })}
          {orgList.length === 0 && <li className="text-sm text-ink-muted">まだ組織がありません。</li>}
        </ul>

        <form action={createMunicipalityAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            <span className="block">自治体をつくる</span>
            <input name="name" required maxLength={60} placeholder="例: 〇〇市" className={`${inputClass} mt-1 w-56`} />
          </label>
          <SubmitButton pendingText="作成中…" className={btnClass}>
            つくる
          </SubmitButton>
        </form>
      </section>

      <section className="mt-12" aria-labelledby="networks-h">
        <h2 id="networks-h" className="text-base font-semibold text-ink">連携グループ({(networks ?? []).length})</h2>
        <p className="mt-1 text-sm text-ink-muted">学校や自治体をまたぐ集まりです(研究会、離島ネットワークなど)。学習者のグループとは別のものです。</p>
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
                      {nameOf.get(id) ?? "(不明)"}
                      <form action={removeNetworkMemberAction.bind(null, n.id as string, id)}>
                        <button type="submit" className="text-ink-muted underline underline-offset-2">
                          外す
                        </button>
                      </form>
                    </li>
                  ))}
                  {memberIds.length === 0 && <li className="text-xs text-ink-muted">まだ入っている組織がありません。</li>}
                </ul>
                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <form action={addNetworkMemberAction.bind(null, n.id as string)} className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-ink-muted">
                      <span className="block">組織を加える</span>
                      <select name="organizationId" className={`${inputClass} mt-1`} defaultValue="">
                        <option value="" disabled>
                          選ぶ
                        </option>
                        {candidates.map((o) => (
                          <option key={o.id as string} value={o.id as string}>
                            {o.name as string}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton pendingText="追加中…" className={btnClass}>
                      加える
                    </SubmitButton>
                  </form>
                  <form action={deleteNetworkAction.bind(null, n.id as string)}>
                    <button type="submit" className="text-xs text-danger underline underline-offset-2">
                      このグループを削除する
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        <form action={createNetworkAction} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-muted">
            <span className="block">連携グループをつくる</span>
            <input name="name" required maxLength={60} placeholder="例: 離島の学校ネットワーク" className={`${inputClass} mt-1 w-64`} />
          </label>
          <SubmitButton pendingText="作成中…" className={btnClass}>
            つくる
          </SubmitButton>
        </form>
      </section>

      <BackLink href="/courses" label="教科・科目一覧" />
    </div>
  );
}
