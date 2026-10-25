/**
 * F11: 個別最適化支援。
 *
 * F09の学習者プロファイル(得意な点・課題・学習履歴の要約)を入力に、要件定義書7章の表に
 * ある4種類の支援案を生成する。あくまで「提案」であり、採用するかどうかは教師(・学習者)が
 * 決める。AIが学習内容や評価を一方的に固定しないよう、断定的な指示ではなく案として書く。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { languageDirective } from "./language";
import type { Lang } from "@/lib/i18n/config";

const PersonalizationSchema = z.object({
  avoidMisconceptionQuestion: z
    .string()
    .describe("この学習者が陥りやすい誤概念を踏まえ、同じ誤解を避けるために次回投げかけるとよい問い"),
  inquiryThemeSuggestion: z
    .string()
    .describe("振り返りに表れた関心に合いそうな、次の探究テーマの提案"),
  promptingAdjustment: z
    .string()
    .describe("発言を促す、または考える時間を確保するための、擬似メンバーの促し方の調整案"),
  difficultyAdjustment: z
    .string()
    .describe("成果物の変化を踏まえた、難度と足場かけ(ヒントの量)の調整案"),
});

export type PersonalizationSuggestion = z.infer<typeof PersonalizationSchema>;

export async function generatePersonalizationSuggestions(params: {
  strengths: string;
  challenges: string;
  summary: string;
  lang?: Lang;
}): Promise<PersonalizationSuggestion> {
  const systemPrompt = `あなたは、学習者プロファイルをもとに次回以降の学習を個別最適化するための
提案を作るアシスタントです。これはあくまで案であり、採用するかどうかは教師と学習者が決めます。
学習内容や評価を一方的に固定するような断定的な書き方はせず、「〜してみる」「〜という手もある」
のような提案の形で書いてください。${languageDirective(params.lang)}`;

  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `学習者プロファイル:\n得意な点: ${params.strengths}\n課題: ${params.challenges}\n学習履歴の要約: ${params.summary}`,
      },
    ],
    text: { format: zodTextFormat(PersonalizationSchema, "personalization_suggestions") },
  });

  return response.output_parsed as PersonalizationSuggestion;
}
