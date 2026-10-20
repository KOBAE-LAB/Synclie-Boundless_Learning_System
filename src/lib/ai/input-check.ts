/**
 * インプット(動画・資料)の理解チェックの問いを、資料の本文から作る。
 *
 * 学習者が自分の言葉で答え、そのあと「答えの目安」と見比べて自分で確かめる形にする(AIが学習者の答えを
 * 採点・判定することはしない。学習時にAIは呼ばない)。教師が確認・修正できる前提の下書き。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";

const CheckSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("資料を見たあとに、自分の言葉で答えられる問い(1文)。丸暗記ではなく、理解を確かめるもの"),
        answerPoints: z.string().describe("答えの目安となる要点(1〜2文)。学習者が自分の答えと見比べる"),
        evidence: z.string().describe("資料のどの部分に書かれているか(資料内の言葉で短く)。無ければ空文字"),
      }),
    )
    .describe("理解チェックの問い"),
});

export type GeneratedCheckQuestions = z.infer<typeof CheckSchema>["questions"];

export async function generateCheckQuestions(params: {
  materialText: string;
  stepInstruction: string;
  count: number;
}): Promise<GeneratedCheckQuestions> {
  const systemPrompt = `あなたは、動画や資料で学んだあとに、学習者が自分の理解を確かめるための問いを作るアシスタントです。
- 問いは、渡された資料の内容に基づくものだけにする。資料に無いことは問わない。
- 暗記の確認だけでなく、「なぜ」「どう違う」など、自分の言葉で説明させる問いを含める。
- 答えの目安は、学習者が自分の答えと見比べるための要点にする(模範解答の丸写しにしない)。
- 問いは${params.count}個。やさしいものから順に並べる。`;

  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `このステップで学習者が取り組むこと: ${params.stepInstruction || "(指定なし)"}\n\n資料の本文:\n${params.materialText}`,
      },
    ],
    text: { format: zodTextFormat(CheckSchema, "check_questions") },
  });
  return (response.output_parsed as z.infer<typeof CheckSchema>).questions.slice(0, params.count);
}
