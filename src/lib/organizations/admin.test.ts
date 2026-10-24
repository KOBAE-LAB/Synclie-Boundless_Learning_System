import { describe, expect, it } from "vitest";
import { normalizeName, validateOrgUpdate } from "./admin";

const base = { orgId: "o1", kind: "school", parentId: "", verified: false, municipalityIds: ["city"] };

describe("validateOrgUpdate", () => {
  it("学校を自治体の下に置ける", () => {
    expect(validateOrgUpdate({ ...base, parentId: "city", verified: true })).toEqual({
      ok: true,
      update: { kind: "school", parent_organization_id: "city", verified: true },
    });
  });
  it("親は空でもよい(自治体に属さない学校)", () => {
    expect(validateOrgUpdate(base)).toMatchObject({ ok: true, update: { parent_organization_id: null } });
  });
  it("自治体でない組織は、親にできない", () => {
    expect(validateOrgUpdate({ ...base, parentId: "other" })).toMatchObject({ ok: false });
  });
  it("自分自身は、親にできない", () => {
    expect(validateOrgUpdate({ ...base, parentId: "o1", municipalityIds: ["o1"] })).toMatchObject({ ok: false });
  });
  it("自治体は、ほかの自治体の下には置かれない(親は外される)", () => {
    expect(validateOrgUpdate({ ...base, kind: "municipality", parentId: "city" })).toMatchObject({ ok: true, update: { kind: "municipality", parent_organization_id: null } });
  });
  it("種類が正しくなければ拒否する", () => {
    expect(validateOrgUpdate({ ...base, kind: "country" })).toMatchObject({ ok: false });
  });
});

describe("normalizeName", () => {
  it("前後の空白を除き、2文字以上だけ受け付ける", () => {
    expect(normalizeName("  長崎県 離島   連携 ")).toBe("長崎県 離島 連携");
    expect(normalizeName("あ")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
  });
});
