// 学習モード(2026-10-22、先生の決定): 教科・科目(course_series)は、作成時に2つのモードのどちらかを選ぶ(作成後は変えない)。
//   - standard = 「教科・科目学習モード」: 教科の内容を、資料と擬似メンバーとの議論で理解する。授業回(第N回)で進め、議論は一人ひとり。
//   - inquiry  = 「探究学習モード」: 自分たちで課題を立てて探究する。テーマと段階で進め、議論は学習者のグループ(時間差)。
// DBの値(course_series.kind)は standard / inquiry のまま。画面に出す名前は、ここだけで決める。
export type StudyMode = "standard" | "inquiry";

export function toStudyMode(kind: unknown): StudyMode {
  return kind === "inquiry" ? "inquiry" : "standard";
}

export const STUDY_MODE_LABELS: Record<StudyMode, string> = {
  standard: "教科・科目学習モード",
  inquiry: "探究学習モード",
};

export const STUDY_MODE_SUMMARIES: Record<StudyMode, string> = {
  standard: "教科の内容を、資料と擬似メンバーとの議論で理解します。授業回ごとに、一人ひとりが議論します。",
  inquiry: "自分たちで課題を立てて探究します。学習者のグループで、時間差で議論し、テーマと段階を進めます。",
};

export function studyModeLabel(kind: unknown): string {
  return STUDY_MODE_LABELS[toStudyMode(kind)];
}
