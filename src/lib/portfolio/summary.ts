import type { PortfolioEntry } from "./types";

export interface PortfolioSummary {
  total: number;
  /** 自己評価をまだ書いていない成果の数 */
  withoutSelfAssessment: number;
  withTeacherComment: number;
  shared: number;
  courseCount: number;
  /** 新しい順に最大3件 */
  latest: PortfolioEntry[];
}

/** 学習ダッシュボードに出す、ポートフォリオの要約(新しい計算やAI呼び出しはしない)。 */
export function summarizePortfolio(entries: PortfolioEntry[]): PortfolioSummary {
  const latest = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  return {
    total: entries.length,
    withoutSelfAssessment: entries.filter((e) => !e.selfAssessment).length,
    withTeacherComment: entries.filter((e) => e.teacherAssessment).length,
    shared: entries.filter((e) => e.shared).length,
    courseCount: new Set(entries.map((e) => e.courseId)).size,
    latest,
  };
}
