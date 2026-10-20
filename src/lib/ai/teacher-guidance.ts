/**
 * 教師ダッシュボードの「指導のヒント」。
 *
 * 学習者の状況(参加・論証評価・つまずき・迷ったこと・議論の問い)をもとに、教師が
 * 「次に学習者の学びをどうファシリテートし、どう指導するとよいか」を提案する。
 * 提案にとどめる(判断・実行は教師)。学習者を点数やラベルで決めつけず、記録に無いことは
 * 推測で断定しない。学習者の氏名は渡さない(仮の呼び名で受け取る。input.ts参照)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";

const GuidanceSchema = z.object({
  classOverview: z.string().describe("授業全体の様子(2〜3文。事実に基づく)"),
  facilitation: z
    .array(z.string())
    .describe("次の授業で、教師が議論をどうファシリテートするとよいか。具体的な声かけ・問い・進め方(最大3つ)"),
  nextActivity: z.string().describe("次の授業で取り組むとよい活動や、投げかけるとよい問いの提案(1〜2文)"),
  individuals: z
    .array(
      z.object({
        label: z.string().describe("入力に出てきた仮の呼び名(例: 学習者A)。入力に無い呼び名は書かない"),
        observation: z.string().describe("記録から読み取れる様子(1文。決めつけない)"),
        suggestedAction: z.string().describe("教師ができる声かけ・支援(1〜2文)"),
      }),
    )
    .describe("個別に声をかけるとよい学習者(最大4人。目立った様子が無ければ空でよい)"),
});

export type TeacherGuidance = z.infer<typeof GuidanceSchema>;

export async function generateTeacherGuidance(courseSummary: string): Promise<TeacherGuidance> {
  const systemPrompt = `あなたは、AI擬似メンバーとの討論で学ぶ授業を担当する教師を支える、授業づくりのアドバイザーです。
授業の記録をもとに、教師が次に学習者の学びをどうファシリテートし、どう指導するとよいかを提案してください。
- 提案は、教師が自分で選べる形(「〜してみる」「〜という手もある」)で、具体的な行動(声かけ・問い・進め方)で書く。
- 学習者の能力や人格を決めつけない。点数は材料にとどめ、点数が低いことをそのまま「できない」と結論しない。
- 記録に無いことを推測で断定しない。記録が少ないときは、その旨を述べて控えめに提案する。
- 個別の提案は、記録から目立った様子が読み取れる学習者だけにする(全員分を無理に作らない)。
- 学習者は「学習者A」のような仮の呼び名で示されている。文中でも必ず「学習者A」と省略せずに書く(「A」「A・B」と略さない)。入力に無い呼び名は書かない。`;

  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: courseSummary },
    ],
    text: { format: zodTextFormat(GuidanceSchema, "teacher_guidance") },
  });
  return response.output_parsed as TeacherGuidance;
}
