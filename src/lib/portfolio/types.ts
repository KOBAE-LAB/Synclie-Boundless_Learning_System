import type { Assessment } from "./assessment";

export interface PortfolioFeedback {
  criteriaLabel: string;
  goodPoints: string;
  nextQuestion: string;
}

export interface PortfolioJudgment {
  logicStructure: number;
  evidenceQuality: number;
  rebuttalResponse: number;
  summaryComment: string;
}

export interface PortfolioReflection {
  whatLearned: string;
  whatConfused: string;
  nextGoal: string;
}

export interface DiscussionSummary {
  summary: string;
  keyPoints: string[];
  nextQuestions: string[];
}

/** ポートフォリオの1件 = 学習者の成果(提出物)1つと、それにつながる記録。 */
export interface PortfolioEntry {
  submissionId: string;
  courseId: string;
  courseTitle: string;
  createdAt: string;
  fiscalYear: number;
  content: string;
  selfAssessment: Assessment | null;
  teacherAssessment: Assessment | null;
  /** 本人が公開用に選んだか(公開リンクで見せる対象) */
  shared: boolean;
  feedback: PortfolioFeedback[];
  judgment: PortfolioJudgment | null;
  reflection: PortfolioReflection | null;
  discussion: DiscussionSummary | null;
}

export interface Portfolio {
  learnerName: string;
  generatedAt: string;
  entries: PortfolioEntry[];
}
