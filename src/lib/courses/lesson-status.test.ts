import { describe, expect, it } from "vitest";
import { fakeAdmin } from "@/lib/inquiry/fake-admin";
import { lessonStatus } from "./lesson-status";
import { ARCHIVED_MESSAGE, assertLessonOpen, LESSON_CLOSED_MESSAGE } from "./series";

describe("lessonStatus(準備中 → 公開中 → 終了)", () => {
  it("公開していなければ準備中、公開すれば公開中", () => {
    expect(lessonStatus({ released: false, closed_at: null }, false)).toBe("preparing");
    expect(lessonStatus({ released: true, closed_at: null }, false)).toBe("open");
  });
  it("授業回を終了すれば、終了", () => {
    expect(lessonStatus({ released: true, closed_at: "2026-10-23T00:00:00Z" }, false)).toBe("closed");
  });
  it("教科・科目が終了していれば、公開済みの授業回は終了。準備中のままの回は準備中", () => {
    expect(lessonStatus({ released: true, closed_at: null }, true)).toBe("closed");
    expect(lessonStatus({ released: false, closed_at: null }, true)).toBe("preparing");
  });
});

describe("assertLessonOpen(新しい発言・提出を受け付けてよいか)", () => {
  type Admin = Parameters<typeof assertLessonOpen>[0];
  const asAdmin = (a: ReturnType<typeof fakeAdmin>) => a as unknown as Admin;
  it("どちらも終了していなければ、通る", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ series_id: "s1", closed_at: null }], course_series: [{ archived_at: null }] } });
    await expect(assertLessonOpen(asAdmin(admin), "c1")).resolves.toBeUndefined();
  });
  it("授業回が終了していれば、授業回の終了のメッセージで止める", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ series_id: "s1", closed_at: "2026-10-23T00:00:00Z" }], course_series: [{ archived_at: null }] } });
    await expect(assertLessonOpen(asAdmin(admin), "c1")).rejects.toThrow(LESSON_CLOSED_MESSAGE);
  });
  it("教科・科目が終了していれば、教科・科目の終了のメッセージで止める", async () => {
    const admin = fakeAdmin({ tables: { courses: [{ series_id: "s1", closed_at: null }], course_series: [{ archived_at: "2027-03-31T00:00:00Z" }] } });
    await expect(assertLessonOpen(asAdmin(admin), "c1")).rejects.toThrow(ARCHIVED_MESSAGE);
  });
});
