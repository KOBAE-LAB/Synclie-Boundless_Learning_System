import { describe, expect, it } from "vitest";
import { normalizeEmail, validatePassword, validateSignupFields } from "./signup-validation";

describe("validatePassword", () => {
  it("10文字未満は拒否する", () => {
    expect(validatePassword("test1234")).not.toBeNull();
  });
  it("10文字以上は受け付ける", () => {
    expect(validatePassword("abcdefghij")).toBeNull();
  });
});

describe("validateSignupFields", () => {
  const ok = { name: "山田 花子", email: "hanako@example.com", password: "abcdefghij" };

  it("正しい入力は通す", () => {
    expect(validateSignupFields(ok)).toBeNull();
  });
  it("名前が空(空白だけ)なら拒否する", () => {
    expect(validateSignupFields({ ...ok, name: "   " })).not.toBeNull();
  });
  it("メールアドレスの形式が不正なら拒否する", () => {
    expect(validateSignupFields({ ...ok, email: "not-an-email" })).not.toBeNull();
  });
  it("短いパスワードなら拒否する", () => {
    expect(validateSignupFields({ ...ok, password: "short" })).not.toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("前後の空白を除いて小文字にする(同じ人が大文字小文字違いで二重登録できないように)", () => {
    expect(normalizeEmail("  Hanako@Example.COM ")).toBe("hanako@example.com");
  });
});
