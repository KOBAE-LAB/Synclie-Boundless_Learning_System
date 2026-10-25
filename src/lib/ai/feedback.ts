/**
 * F07: AIフィードバック(観点別)。
 *
 * 教師が授業ごとに設定した評価の観点(例: 根拠の明確さ、多面的な見方、資料の活用)ごとに、
 * 「良い点」「次に考える問い」「参照すべき資料の箇所」を返す。点数のみは示さない
 * (要件定義書7章: 「点数のみを示さず、次の行動につながる助言を中心にする」)。
 * 教師はこの生成結果を確認・修正できる(submission_feedbackを直接編集する)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { languageDirective } from "./language";
import type { Lang } from "@/lib/i18n/config";

const FeedbackItemSchema = z.object({
  criteriaLabel: z.string().describe("対応する評価観点のラベル(入力と同じ表記で返す)"),
  goodPoints: z.string().describe("良い点(2〜3文)"),
  nextQuestion: z.string().describe("次に考えるとよい問い(1つ、学習者への問いかけの形)"),
  materialReference: z
    .string()
    .describe("参照すべき資料の箇所の要約。資料の範囲に無ければ「該当なし」とする"),
});

const FeedbackResponseSchema = z.object({
  feedback: z.array(FeedbackItemSchema),
});

export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;

export interface EvaluationCriterionInput {
  label: string;
  description: string | null;
}

export async function generateOutcomeFeedback(params: {
  criteria: EvaluationCriterionInput[];
  submissionContent: string;
  materialText: string;
  lang?: Lang;
}): Promise<FeedbackItem[]> {
  const criteriaList = params.criteria
    .map((c, i) => `${i + 1}. ${c.label}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  const systemPrompt = `あなたは学習者の提出物(成果)を、教師が設定した観点ごとに評価するアシスタントです。
点数は付けず、観点ごとに「良い点」「次に考える問い」「参照すべき資料の箇所」を1件ずつ返してください。
資料に書かれていないことを良い点や根拠として断定しないでください。

# 評価の観点(この全てについて、criteriaLabelを一致させて1件ずつ返す)
${criteriaList}

# 資料(この範囲でのみ「参照すべき資料の箇所」を答える。範囲外の内容なら「該当なし」とする)
${params.materialText}${languageDirective(params.lang)}`;

  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `学習者の提出物:\n${params.submissionContent}` },
    ],
    text: { format: zodTextFormat(FeedbackResponseSchema, "outcome_feedback") },
  });

  const parsed = response.output_parsed as z.infer<typeof FeedbackResponseSchema>;
  return parsed.feedback;
}
