import { describe, expect, it } from "vitest";
import { getActiveHref } from "./header-nav";

const student = [
  { label: "授業", href: "/learn" },
  { label: "学習ダッシュボード", href: "/learn/dashboard" },
  { label: "自分のデータ", href: "/learn/data" },
  { label: "授業に参加", href: "/learn/join" },
];
const teacher = [
  { label: "授業", href: "/courses" },
  { label: "組織", href: "/organization" },
  { label: "共有ライブラリ", href: "/library" },
];

describe("getActiveHref", () => {
  it("配下のページでは、親の項目を強調する(授業の中のペルソナ設定でも「授業」)", () => {
    expect(getActiveHref("/courses", teacher)).toBe("/courses");
    expect(getActiveHref("/courses/abc/personas", teacher)).toBe("/courses");
    expect(getActiveHref("/learn/some-course-id", student)).toBe("/learn");
  });

  it("前の部分が同じ項目があっても、一番長く一致した項目だけを強調する", () => {
    expect(getActiveHref("/learn/dashboard", student)).toBe("/learn/dashboard");
    expect(getActiveHref("/learn/join", student)).toBe("/learn/join");
    expect(getActiveHref("/learn/data/x", student)).toBe("/learn/data");
  });

  it("似た名前の別のページや、どれにも当たらないページは強調しない", () => {
    expect(getActiveHref("/courses-other", teacher)).toBeNull();
    expect(getActiveHref("/account/password", teacher)).toBeNull();
  });
});
