import { describe, expect, it } from "vitest";
import { collectSeriesFiles, forceDeleteSeries, summarizeSeriesRecords } from "./series-admin";

type FakeAdmin = Parameters<typeof forceDeleteSeries>[0];

// どのテーブルも、絞り込み条件は無視して、用意した行を返す汎用の偽クライアント(テストデータは1シリーズ分だけ)。
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>) {
  const log: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({ remove: async (paths: string[]) => { log.push(`remove:${bucket}:${paths.sort().join(",")}`); } }),
    },
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "neq", "is", "order"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: rows[0] ?? null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, count: rows.length });
      const del = async () => { log.push(`delete:${table}`); return { error: null }; };
      chain.delete = () => ({ eq: del, in: del });
      return chain;
    },
    log,
  };
  return admin as unknown as FakeAdmin & { log: string[] };
}

const withRecords = {
  courses: [{ id: "c1" }],
  learning_sessions: [{ id: "ls1", student_id: "u1" }, { id: "ls2", student_id: "u2" }],
  submissions: [{ student_id: "u1" }],
  course_materials: [{ storage_path: "c1/doc.pdf" }],
  course_steps: [{ video_path: "c1/step-videos/v.mp4" }],
  dialogue_turns: [{ source_kind: "audio", source_path: "ls1/a.webm" }, { source_kind: "handwriting", source_path: "ls1/h.png" }],
  handwriting_uploads: [{ image_path: "ls1/h2.png" }],
  audio_uploads: [{ audio_path: "ls1/a2.webm" }],
};

describe("collectSeriesFiles", () => {
  it("資料・動画・手書き画像・音声のパスを、バケットごとに集める", async () => {
    const files = await collectSeriesFiles(fakeAdmin(withRecords), "s1");
    expect(files.materials.sort()).toEqual(["c1/doc.pdf", "c1/step-videos/v.mp4"]);
    expect(files.handwriting.sort()).toEqual(["ls1/h.png", "ls1/h2.png"]);
    expect(files.audio.sort()).toEqual(["ls1/a.webm", "ls1/a2.webm"]);
  });
});

describe("summarizeSeriesRecords", () => {
  it("記録のある学習者の数・対話・提出物の件数を数える", async () => {
    expect(await summarizeSeriesRecords(fakeAdmin(withRecords), "s1")).toEqual({ learners: 2, sessions: 2, submissions: 1 });
  });
});

describe("forceDeleteSeries(強制削除の安全装置)", () => {
  const series = (archived: string | null) => ({ ...withRecords, course_series: [{ title: "理科1年 光合成", archived_at: archived }] });

  it("アーカイブしていないシリーズは、強制削除できない", async () => {
    const admin = fakeAdmin(series(null));
    await expect(forceDeleteSeries(admin, "s1", "理科1年 光合成")).rejects.toThrow("アーカイブ");
    expect(admin.log).not.toContain("delete:course_series");
  });
  it("シリーズ名が一致しなければ削除しない", async () => {
    const admin = fakeAdmin(series("2027-03-31T00:00:00Z"));
    await expect(forceDeleteSeries(admin, "s1", "違う名前")).rejects.toThrow("一致しません");
    expect(admin.log).not.toContain("delete:course_series");
  });
  it("アーカイブ済みで名前が一致すれば、記録ごと削除し、3つのバケットのファイルも消す", async () => {
    const admin = fakeAdmin(series("2027-03-31T00:00:00Z"));
    await forceDeleteSeries(admin, "s1", " 理科1年 光合成 ");
    expect(admin.log).toContain("delete:course_series");
    expect(admin.log.some((l) => l.startsWith("remove:materials:"))).toBe(true);
    expect(admin.log.some((l) => l.startsWith("remove:handwriting:"))).toBe(true);
    expect(admin.log.some((l) => l.startsWith("remove:audio:"))).toBe(true);
  });
  it("擬似メンバーを参照する対話ログを先に消してから、シリーズを消す(外部キーの順序)", async () => {
    const admin = fakeAdmin(series("2027-03-31T00:00:00Z"));
    await forceDeleteSeries(admin, "s1", "理科1年 光合成");
    const order = admin.log.filter((l) => l.startsWith("delete:"));
    expect(order.indexOf("delete:dialogue_turns")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("delete:dialogue_turns")).toBeLessThan(order.indexOf("delete:course_series"));
    expect(order.indexOf("delete:portfolio_entries")).toBeLessThan(order.indexOf("delete:course_series"));
  });
  it("存在しないシリーズは拒否する", async () => {
    await expect(forceDeleteSeries(fakeAdmin({}), "s1", "x")).rejects.toThrow("見つかりません");
  });
});
