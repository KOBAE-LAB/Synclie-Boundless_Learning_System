// 管理者が組織の種類・親(自治体)・所属の確認を変えるときの入力チェック(純粋関数、テストあり)。
export const ORG_KINDS = ["school", "municipality", "other"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  school: "学校",
  municipality: "自治体",
  other: "その他の団体",
};

export function isOrgKind(value: unknown): value is OrgKind {
  return typeof value === "string" && (ORG_KINDS as readonly string[]).includes(value);
}

export interface OrgUpdateInput {
  orgId: string;
  kind: string;
  /** 親にする自治体の組織ID(なければ空) */
  parentId: string;
  verified: boolean;
  /** 親にできる自治体の組織IDの集まり(kind が municipality のもの) */
  municipalityIds: string[];
}

export interface OrgUpdate {
  kind: OrgKind;
  parent_organization_id: string | null;
  verified: boolean;
}

/** 検査して、保存する値を返す。問題があれば、管理者に見せる理由を返す。 */
export function validateOrgUpdate(input: OrgUpdateInput): { ok: true; update: OrgUpdate } | { ok: false; error: string } {
  if (!isOrgKind(input.kind)) return { ok: false, error: "組織の種類が正しくありません。" };
  // 自治体は、ほかの自治体の下には置かない(階層は、自治体 → 学校の1段だけ)。
  const parent = input.kind === "municipality" ? "" : input.parentId;
  if (parent) {
    if (parent === input.orgId) return { ok: false, error: "自分自身を、親の自治体にはできません。" };
    if (!input.municipalityIds.includes(parent)) return { ok: false, error: "親にできるのは、種類が「自治体」の組織だけです。" };
  }
  return { ok: true, update: { kind: input.kind, parent_organization_id: parent || null, verified: input.verified } };
}

export const MAX_NAME = 60;

export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
  return name.length >= 2 ? name : null;
}
