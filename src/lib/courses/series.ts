import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

/** 教師が、そのシリーズの担当者かを確かめる(授業回の assertOwnsCourse と対)。 */
export async function assertOwnsSeries(admin: AdminClient, seriesId: string, teacherId: string) {
  const { data: series, error } = await admin
    .from("course_series")
    .select("id, owner_teacher_id")
    .eq("id", seriesId)
    .maybeSingle();
  if (error || !series || series.owner_teacher_id !== teacherId) {
    throw new Error("この授業シリーズを操作する権限がありません。");
  }
}

/** 授業回の表示名。「第3回 光の強さ」。 */
export function lessonName(lessonNo: number, title: string): string {
  return `第${lessonNo}回 ${title}`;
}

/** 「理科1年 第3回 光の強さ」のように、シリーズ名つきの表示名(ポートフォリオ・一覧など、文脈が無い所用)。 */
export function lessonFullName(seriesTitle: string, lessonNo: number, title: string): string {
  return `${seriesTitle} ${lessonName(lessonNo, title)}`;
}

export interface LessonCrumbs {
  seriesId: string;
  seriesTitle: string;
  lessonNo: number;
  /** シリーズがアーカイブ済みか(学習者は記録の閲覧のみ) */
  archived: boolean;
  /** 教師の画面用: 授業シリーズ一覧 › シリーズ › 第N回 */
  teacherTrail: { label: string; href: string }[];
  /** 学習者の画面用: 授業一覧 › シリーズ */
  learnerTrail: { label: string; href: string }[];
}

/**
 * 授業回の画面の「戻る」「パンくず」に使う、親(シリーズ)の情報。
 * 教師の trail は「授業シリーズ一覧 › シリーズ › 第N回」まで、学習者の trail は「授業一覧 › シリーズ」まで。
 */
export async function loadLessonCrumbs(admin: AdminClient, courseId: string): Promise<LessonCrumbs | null> {
  const { data: course } = await admin
    .from("courses")
    .select("id, title, lesson_no, series_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return null;
  const { data: series } = await admin.from("course_series").select("id, title, archived_at").eq("id", course.series_id).maybeSingle();
  if (!series) return null;
  return {
    seriesId: series.id,
    seriesTitle: series.title,
    lessonNo: course.lesson_no,
    archived: !!series.archived_at,
    teacherTrail: [
      { label: "授業シリーズ一覧", href: "/courses" },
      { label: series.title, href: `/series/${series.id}` },
      { label: lessonName(course.lesson_no, course.title), href: `/courses/${courseId}` },
    ],
    learnerTrail: [
      { label: "授業一覧", href: "/learn" },
      { label: series.title, href: `/learn/series/${series.id}` },
    ],
  };
}

/** 授業回のid → 「シリーズ名 第N回 回の名前」。一覧や記録など、親の文脈が無い所で回を名指すとき用。 */
export async function loadLessonLabels(admin: AdminClient, courseIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (courseIds.length === 0) return labels;
  const { data: courses } = await admin.from("courses").select("id, title, lesson_no, series_id").in("id", courseIds);
  const seriesIds = [...new Set((courses ?? []).map((c) => c.series_id))];
  const { data: series } = seriesIds.length > 0
    ? await admin.from("course_series").select("id, title").in("id", seriesIds)
    : { data: [] };
  const seriesTitle = new Map((series ?? []).map((s) => [s.id, s.title]));
  for (const c of courses ?? []) {
    labels.set(c.id, lessonFullName(seriesTitle.get(c.series_id) ?? "", c.lesson_no, c.title));
  }
  return labels;
}

/** 「理科1年 光合成(全8回)」。予定回数が無ければ名前だけ。 */
export function seriesLabel(title: string, plannedLessons: number | null | undefined): string {
  return plannedLessons ? `${title}(全${plannedLessons}回)` : title;
}

/** 日本の年度(4月始まり、日本時間)。 */
export function fiscalYearOfDate(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  return month >= 4 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1;
}

/** 授業回が属するシリーズがアーカイブ済みか(アーカイブ済みは、新しい発言・提出ができない)。 */
export async function isLessonArchived(admin: AdminClient, courseId: string): Promise<boolean> {
  const { data: course } = await admin.from("courses").select("series_id").eq("id", courseId).maybeSingle();
  if (!course) return false;
  const { data: series } = await admin.from("course_series").select("archived_at").eq("id", course.series_id).maybeSingle();
  return !!series?.archived_at;
}

export const ARCHIVED_MESSAGE = "この授業シリーズは終了しています(記録の閲覧のみ)。新しい発言や提出はできません。";
