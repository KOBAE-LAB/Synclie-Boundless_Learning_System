// 授業設定(ねらい・校種学年・討論の型・AIメンバー人数)の定義と、AIに渡す文脈の組み立て。
// DBに触れない純粋な関数だけを置く(テストしやすく、"use server"ファイルからも使えるように)。

export const LEARNER_LEVELS = [
  "小学校 低学年",
  "小学校 中学年",
  "小学校 高学年",
  "中学校",
  "高等学校",
  "大学・大学院",
  "社会人・企業研修",
  "その他・混在",
] as const;

export const DISCUSSION_STYLES = {
  opposing: {
    label: "対立型(異なる立場から議論する)",
    // 擬似メンバーへの指示。どの型でも「根拠なく同調しない」原則(要件定義書2章)は変えない。
    guidance:
      "この授業は対立型の討論です。学習者と異なる立場から、根拠や具体例を求めて問い返してください。",
    recommendation:
      "メンバー同士・学習者との間で立場が分かれるように、互いに対立する立場を含めてください(全員が同じ意見にならないこと)。",
  },
  collaborative: {
    label: "協調型(一緒に結論をつくる)",
    guidance:
      "この授業は協調型の討論です。学習者と一緒に考えを整理し、結論を作る姿勢で関わってください。ただし、根拠のない主張に安易に同調してはいけません。",
    recommendation:
      "メンバーは同じ目標を共有しつつ、着目する観点や得意な視点が異なるようにしてください(視点を補い合う関係)。",
  },
  teaching: {
    label: "教え合い型(分からない仲間に説明する)",
    guidance:
      "この授業は教え合い型です。あなたは学習内容がまだよく分かっていない仲間として、学習者に説明を求め、分からない点を素直に質問してください。",
    recommendation:
      "メンバーは、つまずく点(誤解しやすい点)がそれぞれ異なる『まだ分かっていない仲間』にしてください。",
  },
} as const;

export type DiscussionStyle = keyof typeof DISCUSSION_STYLES;

// 擬似メンバーの発言を作るAIの「推論の深さ」。論証評価などの計測用の呼び出しには適用しない。
// 深さを変えても、実際の応答速度は、思ったほど変わらないことがある(目安)。
export const REASONING_DEPTHS = {
  fast: "速さ優先(浅く考える)",
  standard: "標準",
  deep: "じっくり(深く考える。遅く、費用も増える)",
} as const;
export type ReasoningDepth = keyof typeof REASONING_DEPTHS;
export type ReasoningEffort = "low" | "high";

/** 授業の設定から、OpenAIに渡す reasoning.effort を決める(標準なら指定しない=モデルの既定)。 */
export function reasoningEffortFor(depth: string | null | undefined): ReasoningEffort | undefined {
  if (depth === "fast") return "low";
  if (depth === "deep") return "high";
  return undefined;
}

// 議論の終わり(制限時間)。最初の発言からの経過で数える。
export const TIME_LIMIT_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120] as const;
export const TIME_LIMIT_POLICIES = {
  soft: "超過しても続けられる(超過した時間は記録する)",
  hard: "超過したら発言を止めて、まとめに進む",
} as const;
export type TimeLimitPolicyKey = keyof typeof TIME_LIMIT_POLICIES;

export function isDiscussionStyle(value: unknown): value is DiscussionStyle {
  return typeof value === "string" && value in DISCUSSION_STYLES;
}

export interface CourseSettings {
  title?: string | null;
  subject?: string | null;
  mode?: string | null;
  objective?: string | null;
  learner_level?: string | null;
  discussion_style?: string | null;
  ai_member_count?: number | null;
  discussion_liveliness?: string | null;
  reasoning_depth?: string | null;
  time_limit_minutes?: number | null;
  time_limit_policy?: string | null;
  time_limit_affects_evaluation?: boolean | null;
  ai_close_suggestion?: boolean | null;
}

const MAX_OBJECTIVE_LENGTH = 1000;

/** フォームの入力を、保存してよい形に整える(不正な値は null にする)。 */
export function parseCourseSettingsInput(input: {
  objective: string;
  learnerLevel: string;
  discussionStyle: string;
  aiMemberCount: string;
  // 擬似メンバーの発言の活発さ(省略=普通)
  discussionLiveliness?: string;
  // 擬似メンバーの推論の深さ(省略=標準)
  reasoningDepth?: string;
  // 議論の終わり(省略すると、未設定=制限なし・超過しても続けられる・評価に影響しない・AIが提案する)
  timeLimitMinutes?: string;
  timeLimitPolicy?: string;
  timeLimitAffectsEvaluation?: boolean;
  aiCloseSuggestion?: boolean;
}): {
  objective: string | null;
  learner_level: string | null;
  discussion_style: DiscussionStyle | null;
  ai_member_count: number | null;
  discussion_liveliness: "quiet" | "normal" | "lively";
  reasoning_depth: ReasoningDepth;
  time_limit_minutes: number | null;
  time_limit_policy: TimeLimitPolicyKey;
  time_limit_affects_evaluation: boolean;
  ai_close_suggestion: boolean;
} {
  const objective = input.objective.trim().slice(0, MAX_OBJECTIVE_LENGTH);
  const level = input.learnerLevel.trim();
  const count = Number.parseInt(input.aiMemberCount, 10);
  const limit = Number.parseInt(input.timeLimitMinutes ?? "", 10);
  return {
    objective: objective || null,
    learner_level: (LEARNER_LEVELS as readonly string[]).includes(level) ? level : null,
    discussion_style: isDiscussionStyle(input.discussionStyle) ? input.discussionStyle : null,
    ai_member_count: Number.isInteger(count) && count >= 1 && count <= 5 ? count : null,
    discussion_liveliness:
      input.discussionLiveliness === "quiet" || input.discussionLiveliness === "lively" ? input.discussionLiveliness : "normal",
    reasoning_depth: input.reasoningDepth === "fast" || input.reasoningDepth === "deep" ? input.reasoningDepth : "standard",
    time_limit_minutes: (TIME_LIMIT_OPTIONS as readonly number[]).includes(limit) ? limit : null,
    time_limit_policy: input.timeLimitPolicy === "hard" ? "hard" : "soft",
    // 制限時間が無い授業で、評価への影響だけが立つことは無い
    time_limit_affects_evaluation:
      (TIME_LIMIT_OPTIONS as readonly number[]).includes(limit) && input.timeLimitAffectsEvaluation === true,
    ai_close_suggestion: input.aiCloseSuggestion ?? true,
  };
}

/**
 * 擬似メンバーのシステムプロンプトに入れる「この授業の文脈」。設定が何も無ければ undefined。
 * 同調禁止などの共通ガードレール(persona.ts の COMMON_GUARDRAILS)は、これで上書きしない。
 */
export function buildCourseContext(course: CourseSettings): string | undefined {
  const lines: string[] = [];
  if (course.title) lines.push(`- 授業名: ${course.title}`);
  if (course.objective) lines.push(`- 授業のねらい・議題: ${course.objective}`);
  if (course.learner_level) {
    lines.push(
      `- 学習者: ${course.learner_level}(この学習者に合った言葉づかい・難しさで話すこと)`,
    );
  }
  if (isDiscussionStyle(course.discussion_style)) {
    lines.push(`- 討論の型: ${DISCUSSION_STYLES[course.discussion_style].guidance}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}
