// 先輩のAI(先輩型・集約型)の「公開範囲」の決まり(「他校型」の代わりの設計、0049)。誰が見て使えるか、広げる申請が通るかを、ここにまとめる(テストあり)。
//   private = 作った先生だけ / school = 同じ学校(組織)の先生(今までどおり) / municipality = 同じ自治体の学校 / network = 連携グループの学校
// 広い範囲(municipality / network)は、(1)所属の確かな組織(verified)どうし、(2)組織の承認者の承認、(3)材料の学習者全員の別の同意
// (share_wide)、(4)他校向けに特定されにくくした版 がそろって、はじめて使える。
export type ShareScope = "private" | "school" | "municipality" | "network";
export type WideScope = "municipality" | "network";

export const SHARE_SCOPE_LABELS: Record<ShareScope, string> = {
  private: "自分だけ",
  school: "同じ学校の先生",
  municipality: "同じ自治体の学校",
  network: "連携グループの学校",
};

export const SHARE_SCOPES: ShareScope[] = ["private", "school", "municipality", "network"];

export function isShareScope(value: unknown): value is ShareScope {
  return typeof value === "string" && (SHARE_SCOPES as string[]).includes(value);
}

export function isWideScope(scope: string | null | undefined): scope is WideScope {
  return scope === "municipality" || scope === "network";
}

export interface OrgInfo {
  id: string;
  name: string;
  /** school / municipality / other */
  kind: string;
  /** 学校の親(自治体)。自治体の組織は親を持たない */
  parentId: string | null;
  /** 所属が確かな組織(SSOのテナントから作られた組織、または管理者が確かめた組織) */
  verified: boolean;
  /** この組織が入っている連携グループ */
  networkIds: string[];
}

export interface ScopedPersona {
  createdBy: string | null;
  ownerOrg: OrgInfo | null;
  shareScope: ShareScope;
  shareNetworkId: string | null;
}

export interface Viewer {
  teacherId: string;
  org: OrgInfo | null;
}

/** この組織が属する自治体のID: 自治体の組織ならそれ自身、学校なら親(親が無ければ null)。 */
export function municipalityIdOf(org: Pick<OrgInfo, "id" | "kind" | "parentId"> | null | undefined): string | null {
  if (!org) return null;
  if (org.kind === "municipality") return org.id;
  return org.parentId ?? null;
}

/** この先生が、この先輩のAIを見て(授業回に貸し出して)使えるか。 */
export function canSeeScoped(persona: ScopedPersona, viewer: Viewer): boolean {
  if (persona.createdBy && persona.createdBy === viewer.teacherId) return true;
  if (persona.shareScope === "private") return false;
  const owner = persona.ownerOrg;
  const mine = viewer.org;
  if (!owner || !mine) return false;
  if (owner.id === mine.id) return true; // 同じ学校(組織)
  if (persona.shareScope === "school") return false;
  // 広い範囲: どちらの組織も、所属が確かであること
  if (!owner.verified || !mine.verified) return false;
  if (persona.shareScope === "municipality") {
    const a = municipalityIdOf(owner);
    return a !== null && a === municipalityIdOf(mine);
  }
  // network: 持ち主の組織も、見る側の組織も、そのグループに入っていること
  const networkId = persona.shareNetworkId;
  return networkId !== null && owner.networkIds.includes(networkId) && mine.networkIds.includes(networkId);
}

/** 貸し出しの区分: 持ち主の組織と違う組織の先生が貸し出すなら cross_org。 */
export function loanScopeFor(ownerOrgId: string | null, lenderOrgId: string | null): "same_school" | "cross_org" {
  return ownerOrgId && lenderOrgId && ownerOrgId === lenderOrgId ? "same_school" : "cross_org";
}

export interface ScopeRequestInput {
  requested: ShareScope;
  networkId: string | null;
  ownerOrg: OrgInfo | null;
}

/** 公開範囲を変えるときの決まり。問題があれば、先生に見せる理由を返す(無ければ null)。 */
export function validateScopeChange(input: ScopeRequestInput): string | null {
  if (input.requested === "private" || input.requested === "school") return null; // 狭める・今までどおりは、承認なしで変えられる
  const owner = input.ownerOrg;
  if (!owner) return "組織に参加してから、広げる申請をしてください。";
  if (!owner.verified) return "所属が確かめられた組織だけが、広い範囲に公開できます(管理者に、組織の確認を依頼してください)。";
  if (input.requested === "municipality") {
    if (!municipalityIdOf(owner)) return "この学校は、自治体に属していません(管理者に、自治体への所属の登録を依頼してください)。";
    return null;
  }
  if (!input.networkId) return "公開する連携グループを選んでください。";
  if (!owner.networkIds.includes(input.networkId)) return "この学校が入っていない連携グループには、公開できません。";
  return null;
}

/** 広げる申請は、持ち主の組織の承認者が承認して、はじめて有効になる。狭める変更は、すぐ有効。 */
export function needsApproval(requested: ShareScope): boolean {
  return isWideScope(requested);
}
