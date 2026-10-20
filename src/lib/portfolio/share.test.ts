import { describe, expect, it } from "vitest";
import { computeExpiry, generateShareToken, resolveShareLink, shareLinkStatus } from "./share";

const now = new Date("2026-10-20T00:00:00Z");

function fakeAdmin(row: unknown) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
  } as never;
}
const TOKEN = "a".repeat(32);

describe("shareLinkStatus", () => {
  it("取り消し・期限切れ・有効を区別する", () => {
    expect(shareLinkStatus({ expires_at: "2026-11-01T00:00:00Z", revoked_at: null }, now)).toBe("active");
    expect(shareLinkStatus({ expires_at: "2026-10-01T00:00:00Z", revoked_at: null }, now)).toBe("expired");
    expect(shareLinkStatus({ expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-10-10T00:00:00Z" }, now)).toBe("revoked");
  });
});

describe("resolveShareLink", () => {
  it("有効なリンクは持ち主を返す", async () => {
    const r = await resolveShareLink(fakeAdmin({ student_id: "u1", label: "x", expires_at: "2026-11-01T00:00:00Z", revoked_at: null }), TOKEN, now);
    expect(r).toEqual({ studentId: "u1", label: "x" });
  });
  it("存在しない・期限切れ・取り消し済み・短すぎるトークンは null", async () => {
    expect(await resolveShareLink(fakeAdmin(null), TOKEN, now)).toBeNull();
    expect(await resolveShareLink(fakeAdmin({ student_id: "u1", label: null, expires_at: "2026-10-01T00:00:00Z", revoked_at: null }), TOKEN, now)).toBeNull();
    expect(await resolveShareLink(fakeAdmin({ student_id: "u1", label: null, expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-10-02T00:00:00Z" }), TOKEN, now)).toBeNull();
    expect(await resolveShareLink(fakeAdmin({ student_id: "u1", label: null, expires_at: "2026-11-01T00:00:00Z", revoked_at: null }), "short", now)).toBeNull();
  });
});

describe("token / expiry", () => {
  it("トークンは十分長く、毎回異なる", () => {
    const a = generateShareToken();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(generateShareToken());
  });
  it("期限は許可された日数だけ(それ以外は最短)", () => {
    expect(computeExpiry(30, now)).toBe("2026-11-19T00:00:00.000Z");
    expect(computeExpiry(9999, now)).toBe("2026-10-27T00:00:00.000Z");
  });
});
