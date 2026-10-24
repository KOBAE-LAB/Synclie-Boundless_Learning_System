import { describe, expect, it } from "vitest";
import {
  canSeeScoped,
  isWideScope,
  loanScopeFor,
  municipalityIdOf,
  needsApproval,
  validateScopeChange,
  type OrgInfo,
  type ScopedPersona,
} from "./scope";

const org = (id: string, over: Partial<OrgInfo> = {}): OrgInfo => ({
  id,
  name: id,
  kind: "school",
  parentId: null,
  verified: true,
  networkIds: [],
  ...over,
});
const persona = (over: Partial<ScopedPersona> = {}): ScopedPersona => ({
  createdBy: "owner",
  ownerOrg: org("A", { parentId: "city" }),
  shareScope: "school",
  shareNetworkId: null,
  ...over,
});
const viewer = (id: string, o: OrgInfo | null) => ({ teacherId: id, org: o });

describe("canSeeScoped", () => {
  it("作った先生は、公開範囲に関わらず見られる", () => {
    expect(canSeeScoped(persona({ shareScope: "private" }), viewer("owner", null))).toBe(true);
  });
  it("自分だけ(private)は、同じ学校の先生にも見えない", () => {
    expect(canSeeScoped(persona({ shareScope: "private" }), viewer("t2", org("A")))).toBe(false);
  });
  it("同じ学校(school)は、同じ組織の先生だけ見える(今までどおり)", () => {
    expect(canSeeScoped(persona(), viewer("t2", org("A")))).toBe(true);
    expect(canSeeScoped(persona(), viewer("t3", org("B", { parentId: "city" })))).toBe(false);
  });
  it("組織に入っていない先生には、他人の先輩のAIは見えない", () => {
    expect(canSeeScoped(persona(), viewer("t2", null))).toBe(false);
  });
  it("同じ自治体(municipality)は、同じ自治体の学校の先生が見える", () => {
    const p = persona({ shareScope: "municipality" });
    expect(canSeeScoped(p, viewer("t2", org("B", { parentId: "city" })))).toBe(true);
    expect(canSeeScoped(p, viewer("t3", org("C", { parentId: "other-city" })))).toBe(false);
    expect(canSeeScoped(p, viewer("t4", org("D")))).toBe(false); // 自治体に属していない学校
  });
  it("自治体の組織自身の先生も、その自治体の範囲に含まれる", () => {
    const p = persona({ shareScope: "municipality" });
    expect(canSeeScoped(p, viewer("t2", org("city", { kind: "municipality" })))).toBe(true);
  });
  it("広い範囲は、所属が確かでない組織には見えない(自己申告の組織名だけでは入れない)", () => {
    const p = persona({ shareScope: "municipality" });
    expect(canSeeScoped(p, viewer("t2", org("B", { parentId: "city", verified: false })))).toBe(false);
    const unverifiedOwner = persona({ shareScope: "municipality", ownerOrg: org("A", { parentId: "city", verified: false }) });
    expect(canSeeScoped(unverifiedOwner, viewer("t2", org("B", { parentId: "city" })))).toBe(false);
  });
  it("連携グループ(network)は、持ち主も見る側も、そのグループに入っているときだけ見える", () => {
    const p = persona({ shareScope: "network", shareNetworkId: "net", ownerOrg: org("A", { networkIds: ["net"] }) });
    expect(canSeeScoped(p, viewer("t2", org("B", { networkIds: ["net"] })))).toBe(true);
    expect(canSeeScoped(p, viewer("t3", org("C", { networkIds: ["other"] })))).toBe(false);
    // 持ち主の学校がグループから外れたら、見えなくなる
    const left = persona({ shareScope: "network", shareNetworkId: "net", ownerOrg: org("A", { networkIds: [] }) });
    expect(canSeeScoped(left, viewer("t2", org("B", { networkIds: ["net"] })))).toBe(false);
  });
  it("同じ学校なら、広い範囲に広げても見える", () => {
    expect(canSeeScoped(persona({ shareScope: "municipality" }), viewer("t2", org("A", { parentId: "city" })))).toBe(true);
  });
});

describe("loanScopeFor", () => {
  it("同じ組織なら same_school、違う組織・組織が無いなら cross_org", () => {
    expect(loanScopeFor("A", "A")).toBe("same_school");
    expect(loanScopeFor("A", "B")).toBe("cross_org");
    expect(loanScopeFor(null, "A")).toBe("cross_org");
  });
});

describe("validateScopeChange", () => {
  it("狭める・同じ学校へは、承認なしで変えられる", () => {
    expect(validateScopeChange({ requested: "private", networkId: null, ownerOrg: null })).toBeNull();
    expect(validateScopeChange({ requested: "school", networkId: null, ownerOrg: null })).toBeNull();
    expect(needsApproval("private")).toBe(false);
    expect(needsApproval("school")).toBe(false);
  });
  it("広げる申請には承認が要る", () => {
    expect(needsApproval("municipality")).toBe(true);
    expect(needsApproval("network")).toBe(true);
    expect(isWideScope("network")).toBe(true);
    expect(isWideScope("school")).toBe(false);
  });
  it("所属が確かでない組織は、広げられない", () => {
    expect(validateScopeChange({ requested: "municipality", networkId: null, ownerOrg: org("A", { verified: false, parentId: "c" }) })).toMatch(/確かめられた/);
  });
  it("自治体に属していない学校は、自治体へ広げられない", () => {
    expect(validateScopeChange({ requested: "municipality", networkId: null, ownerOrg: org("A") })).toMatch(/自治体に属していません/);
    expect(validateScopeChange({ requested: "municipality", networkId: null, ownerOrg: org("A", { parentId: "c" }) })).toBeNull();
  });
  it("連携グループへは、自分の学校が入っているグループだけ選べる", () => {
    expect(validateScopeChange({ requested: "network", networkId: null, ownerOrg: org("A") })).toMatch(/選んで/);
    expect(validateScopeChange({ requested: "network", networkId: "x", ownerOrg: org("A", { networkIds: ["y"] }) })).toMatch(/入っていない/);
    expect(validateScopeChange({ requested: "network", networkId: "x", ownerOrg: org("A", { networkIds: ["x"] }) })).toBeNull();
  });
});

describe("municipalityIdOf", () => {
  it("自治体は自分自身、学校は親、親が無ければ null", () => {
    expect(municipalityIdOf({ id: "c", kind: "municipality", parentId: null })).toBe("c");
    expect(municipalityIdOf({ id: "s", kind: "school", parentId: "c" })).toBe("c");
    expect(municipalityIdOf({ id: "s", kind: "school", parentId: null })).toBeNull();
    expect(municipalityIdOf(null)).toBeNull();
  });
});
