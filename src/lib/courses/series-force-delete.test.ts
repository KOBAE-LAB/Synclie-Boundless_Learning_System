import { describe, expect, it } from "vitest";
import { collectSeriesFiles, deleteSeries, forceDeleteSeries, summarizeSeriesRecords } from "./series-admin";

type FakeAdmin = Parameters<typeof forceDeleteSeries>[0];

// どのテーブルも、絞り込み条件は無視して、用意した行を返す汎用の偽クライアント(テストデータは1教科・科目分だけ)。
// selectErrors に書いたテーブルは、読み取りがエラーになる(0042が未適用のDBで、新しい列を読んだときの再現)。
function fakeAdmin(tables: Record<string, Record<string, unknown>[]>, selectErrors: Record<string, string> = {}) {
  const log: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({ remove: async (paths: string[]) => { log.push(`remove:${bucket}:${paths.sort().join(",")}`); } }),
    },
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "neq", "is", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: rows[0] ?? null });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve(
          selectErrors[table]
            ? { data: null, count: null, error: { message: selectErrors[table] } }
            : { data: rows, count: rows.length, error: null },
        );
      const del = async () => { log.push(`delete:${table}`); return { error: null }; };
      chain.delete = () => ({ eq: del, in: del });
      chain.update = () => { log.push(`update:${table}`); return chain; };
      chain.upsert = async () => ({ error: null });
      chain.insert = () => { log.push(`insert:${table}`); return chain; };
      chain.single = async () => ({ data: { id: `${table}-new` }, error: null });
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

  it("アーカイブしていない教科・科目は、強制削除できない", async () => {
    const admin = fakeAdmin(series(null));
    await expect(forceDeleteSeries(admin, "s1", "理科1年 光合成")).rejects.toThrow("アーカイブ");
    expect(admin.log).not.toContain("delete:course_series");
  });
  it("教科・科目名が一致しなければ削除しない", async () => {
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
  it("擬似メンバーを参照する対話ログを先に消してから、教科・科目を消す(外部キーの順序)", async () => {
    const admin = fakeAdmin(series("2027-03-31T00:00:00Z"));
    await forceDeleteSeries(admin, "s1", "理科1年 光合成");
    const order = admin.log.filter((l) => l.startsWith("delete:"));
    expect(order.indexOf("delete:dialogue_turns")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("delete:dialogue_turns")).toBeLessThan(order.indexOf("delete:course_series"));
    expect(order.indexOf("delete:portfolio_entries")).toBeLessThan(order.indexOf("delete:course_series"));
  });
  it("存在しない教科・科目は拒否する", async () => {
    await expect(forceDeleteSeries(fakeAdmin({}), "s1", "x")).rejects.toThrow("見つかりません");
  });
});

describe("deleteSeries(通常の削除: 授業の構成だけを消し、学習者の記録は残す。0042)", () => {
  const lessonRows = { courses: [{ id: "c1", title: "光合成", lesson_no: 1, series_id: "s1" }], course_series: [{ title: "理科1年", owner_teacher_id: "t1", fiscal_year: 2026 }] };

  it("学習者の記録を消さず、授業の構成(教科・科目)と資料・動画のファイルだけを消す", async () => {
    const admin = fakeAdmin({ ...withRecords, ...lessonRows });
    await deleteSeries(admin, "s1");
    const deletes = admin.log.filter((l) => l.startsWith("delete:"));
    expect(deletes).toEqual(["delete:course_series"]);
    expect(admin.log.some((l) => l.startsWith("remove:materials:"))).toBe(true);
    // 手書き画像・音声は学習者の記録なので残す
    expect(admin.log.some((l) => l.startsWith("remove:handwriting:"))).toBe(false);
    expect(admin.log.some((l) => l.startsWith("remove:audio:"))).toBe(false);
  });

  it("消す前に、記録に授業の控えを書き込む", async () => {
    const admin = fakeAdmin({ ...withRecords, ...lessonRows });
    await deleteSeries(admin, "s1");
    const firstDelete = admin.log.indexOf("delete:course_series");
    expect(admin.log.indexOf("update:learning_sessions")).toBeGreaterThanOrEqual(0);
    expect(admin.log.indexOf("update:learning_sessions")).toBeLessThan(firstDelete);
    expect(admin.log.indexOf("update:submissions")).toBeLessThan(firstDelete);
  });

  it("0042(学習記録の保護)が入っていないDBでは、記録のある教科・科目を削除しない(連鎖で記録が消えるため)", async () => {
    const admin = fakeAdmin({ ...withRecords, ...lessonRows }, { learning_sessions: 'column "course_label" does not exist' });
    await expect(deleteSeries(admin, "s1")).rejects.toThrow("0042");
    expect(admin.log).not.toContain("delete:course_series");
  });
});

describe("forceDeleteSeries(テストデータの消去: 記録を明示的に消す)", () => {
  const series = { ...withRecords, course_series: [{ title: "理科1年 光合成", archived_at: "2027-03-31T00:00:00Z" }] };

  it("記録(成果・セッション・進み・学習計画・探究プロジェクト)を、教科・科目より先に消す", async () => {
    const admin = fakeAdmin(series);
    await forceDeleteSeries(admin, "s1", "理科1年 光合成");
    const order = admin.log.filter((l) => l.startsWith("delete:"));
    const at = (t: string) => order.indexOf(`delete:${t}`);
    for (const t of ["submissions", "learning_sessions", "step_progress", "study_plan_items", "inquiry_projects"]) {
      expect(at(t)).toBeGreaterThanOrEqual(0);
      expect(at(t)).toBeLessThan(at("course_series"));
    }
    // 記録が探究プロジェクトを参照しているので、プロジェクトは記録の後
    expect(at("inquiry_projects")).toBeGreaterThan(at("learning_sessions"));
    expect(at("inquiry_projects")).toBeGreaterThan(at("submissions"));
  });
});
