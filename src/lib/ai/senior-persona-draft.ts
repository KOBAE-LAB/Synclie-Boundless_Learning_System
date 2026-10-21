/**
 * ③投射層: 先輩型ペルソナの下書き(要件定義書14章ステップ6)。
 * 先輩の探究プロジェクトの軌跡から、ペルソナの役割・口調・そのときの問い・後輩との関わり方を、1回の呼び出しで作る。
 * 教師が確認・修正して承認するまで使わない(F04の下書き→承認と同じ)。名前は教師が付ける呼び名から作るので、ここでは作らない。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { clip } from "./stage-story";

const DraftSchema = z.object({
  role: z.string().describe("後輩から見た、この先輩の役割(40字以内)。例: 「仮説を何度も立て直した先輩」"),
  tone: z.string().describe("話し方(40字以内)。記録の語りから感じられる口調。例: 「くだけた敬語で、迷いも正直に話す」"),
  position: z.string().describe("先輩が探究で抱えていた問い・考え(120字以内)。記録に書かれていることだけ"),
  goal: z.string().describe("後輩との関わり方(120字以内)。答えを教えず、自分の経験を材料に問い返す方向で"),
});

export type SeniorPersonaDraft = z.infer<typeof DraftSchema>;

export async function draftSeniorPersona(input: { theme: string; trajectory: string; stageNames: string[] }): Promise<SeniorPersonaDraft> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      {
        role: "system",
        content: `あなたは、探究学習の記録から、後輩の探究に伴走する「先輩のAI」の設定を下書きします。
先輩本人ではなく、先輩の記録をもとにしたAIです。教師が確認・修正してから使います。

書き方:
- 記録に書かれていることだけを使う。性格や出来事を推測で足さない。
- 人の名前・学校名・地名・クラス名は書かない。
- 先輩が自分のやり方を答えとして押し付けない設定にする(「自分のときはこうだった」を材料に、後輩に問い返す)。`,
      },
      {
        role: "user",
        content: `【探究のテーマ】${input.theme || "(未設定)"}\n【通った段階】${input.stageNames.join(" → ") || "(不明)"}\n\n【軌跡】\n${input.trajectory}`,
      },
    ],
    text: { format: zodTextFormat(DraftSchema, "senior_persona_draft") },
  });
  const parsed = response.output_parsed as SeniorPersonaDraft | null;
  if (!parsed) throw new Error("先輩のペルソナの下書きを作れませんでした。");
  return {
    role: clip(parsed.role, 40),
    tone: clip(parsed.tone, 40),
    position: clip(parsed.position, 120),
    goal: clip(parsed.goal, 120),
  };
}
