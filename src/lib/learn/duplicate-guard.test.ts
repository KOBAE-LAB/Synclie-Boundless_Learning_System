import { describe, expect, it } from "vitest";
import { fakeAdmin } from "@/lib/inquiry/fake-admin";
import { DUPLICATE_SUBMISSION_WINDOW_MS, hasRecentIdenticalSubmission, isRecentDuplicate, tryAcquireSubmissionLock } from "./duplicate-guard";

const now = Date.parse("2026-10-23T01:51:41Z");
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

describe("isRecentDuplicate(成果の二重送信)", () => {
  it("同じ内容が1秒前にあれば、二重送信", () => {
    expect(isRecentDuplicate([{ content: "意味がありませんでした。", created_at: at(1) }], "意味がありませんでした。", now)).toBe(true);
  });
  it("前後の空白だけ違っても、同じ内容とみなす", () => {
    expect(isRecentDuplicate([{ content: "考え\n", created_at: at(2) }], "  考え", now)).toBe(true);
  });
  it("内容が違えば、二重送信ではない", () => {
    expect(isRecentDuplicate([{ content: "別の考え", created_at: at(1) }], "考え", now)).toBe(false);
  });
  it("同じ内容でも、十分に時間があいていれば、新しい提出(書き直して再提出など)", () => {
    expect(isRecentDuplicate([{ content: "考え", created_at: at(DUPLICATE_SUBMISSION_WINDOW_MS / 1000 + 5) }], "考え", now)).toBe(false);
  });
  it("提出が無い・日時が読めないときは、二重送信ではない", () => {
    expect(isRecentDuplicate([], "考え", now)).toBe(false);
    expect(isRecentDuplicate([{ content: "考え", created_at: "壊れた日時" }], "考え", now)).toBe(false);
    expect(isRecentDuplicate([{ content: "考え", created_at: null }], "考え", now)).toBe(false);
  });
});

describe("hasRecentIdenticalSubmission", () => {
  type Admin = Parameters<typeof hasRecentIdenticalSubmission>[0];
  it("直近の提出の中に同じ内容があれば true", async () => {
    const admin = fakeAdmin({ tables: { submissions: [{ content: "考え", created_at: at(1) }] } });
    expect(await hasRecentIdenticalSubmission(admin as unknown as Admin, { studentId: "u1", courseId: "c1", content: "考え", nowMs: now })).toBe(true);
  });
  it("提出が無ければ false", async () => {
    const admin = fakeAdmin({ tables: { submissions: [] } });
    expect(await hasRecentIdenticalSubmission(admin as unknown as Admin, { studentId: "u1", courseId: "c1", content: "考え", nowMs: now })).toBe(false);
  });
});

describe("tryAcquireSubmissionLock(ほぼ同時の二重送信)", () => {
  it("同じ提出が処理中なら、2つ目は取れない。処理が終われば、また取れる", () => {
    const release = tryAcquireSubmissionLock("u1", "c1", "考え");
    expect(release).not.toBeNull();
    expect(tryAcquireSubmissionLock("u1", "c1", "考え")).toBeNull();
    expect(tryAcquireSubmissionLock("u1", "c1", "  考え ")).toBeNull(); // 前後の空白は同じ内容
    release!();
    const again = tryAcquireSubmissionLock("u1", "c1", "考え");
    expect(again).not.toBeNull();
    again!();
  });
  it("学習者・授業回・内容のどれかが違えば、別の提出", () => {
    const a = tryAcquireSubmissionLock("u1", "c1", "考え");
    const others = [tryAcquireSubmissionLock("u2", "c1", "考え"), tryAcquireSubmissionLock("u1", "c2", "考え"), tryAcquireSubmissionLock("u1", "c1", "別の考え")];
    expect(others.every((o) => o !== null)).toBe(true);
    [a, ...others].forEach((r) => r!());
  });
});
