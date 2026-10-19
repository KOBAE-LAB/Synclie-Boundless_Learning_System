/**
 * 議論の「終わり」に関するAI呼び出し。
 *  - judgeDiscussionState: 議論が収束した/堂々めぐり/脱線しているかを軽く判定し、「まとめ」を提案するか決める
 *  - summarizeDiscussion: 終了時に、議論の要点と、次に考える問いをまとめる
 *
 * どちらも、擬似メンバーの返答(F05)や論証評価(F20)とは別の、補助的な呼び出し。
 * 議論の状態の判定は、返答を待たせないよう、返答と並行して行う(呼び出し側で並列化)。
 * AIが一方的に議論を止めることはしない: 判定は「提案」にとどめ、まとめに進むかは学習者が決める。
 * (時間切れでの終了は、教師が設定した制限時間のルールに従う)
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";

const StateSchema = z.object({
  state: z
    .enum(["continue", "converged", "stalled", "off_topic"])
    .describe("continue=まだ深まっている / converged=一定の結論や合意に収束した / stalled=同じ主張の繰り返しで進展がない / off_topic=議題から外れている"),
  reason: z.string().describe("そう判断した理由を、学習者に向けて1〜2文で(やさしい言葉で)"),
});

export type DiscussionState = z.infer<typeof StateSchema>["state"];

export interface DiscussionStateJudgment {
  state: DiscussionState;
  reason: string;
}

export function buildStatePrompt(objective: string | null | undefined): string {
  return `あなたは、学習者と複数のAI擬似メンバーによる議論を見守る進行役です。次の議論の状態を判定してください。

授業のねらい・議題: ${objective || "(未設定。やり取りの内容から推測する)"}

判定の基準:
- continue: 新しい論点・根拠・反論が出ていて、まだ議論が深まっている。迷うときはこれにする。
- converged: 議題について、一定の結論や、お互いの理解の到達点が見えてきた。
- stalled: 同じ主張・同じ問いの繰り返しで、新しい根拠や論点が出なくなっている。
- off_topic: 議題からずれたやり取りが続いている。
議論を止めるべきかどうかは、人間が決めます。あなたは、状態と理由を述べるだけにしてください。`;
}

export async function judgeDiscussionState(
  transcript: string,
  objective: string | null | undefined,
): Promise<DiscussionStateJudgment> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: buildStatePrompt(objective) },
      { role: "user", content: `次の議論の記録を見て、いまの状態を判定してください。\n\n${transcript}` },
    ],
    text: { format: zodTextFormat(StateSchema, "discussion_state") },
  });
  const parsed = response.output_parsed as DiscussionStateJudgment | null;
  if (!parsed) return { state: "continue", reason: "" };
  return parsed;
}

const SummarySchema = z.object({
  summary: z.string().describe("議論の流れと到達点を、学習者に向けて3〜5文で(やさしい言葉で)"),
  keyPoints: z.array(z.string()).describe("議論で出た大事な論点・根拠を、短く2〜4個"),
  nextQuestions: z.array(z.string()).describe("次に考えるとよい問いを、2〜3個(答えは示さない)"),
});

export type DiscussionSummary = z.infer<typeof SummarySchema>;

export function buildSummaryPrompt(params: {
  objective: string | null | undefined;
  learnerLevel: string | null | undefined;
  materialText: string;
}): string {
  return `あなたは、学習者と複数のAI擬似メンバーによる議論を、最後にまとめる進行役です。
議論の記録をもとに、学習者が自分の考えを整理して、成果(レポートや意見)にまとめられるように手伝ってください。

授業のねらい・議題: ${params.objective || "(未設定)"}
学習者: ${params.learnerLevel || "(未設定)"}(この学習者に合った言葉づかいにする)

守ること:
- 議論に出ていない内容を付け足さない。資料の範囲を超えて断定しない。
- 学習者の考えを代わりに結論づけない。到達点と、まだ決まっていない点を分けて示す。
- 次に考える問いには、答えを書かない(自分で考えるための問いにする)。

# 参考資料(抜粋)
${params.materialText.slice(0, 4000) || "(なし)"}`;
}

export async function summarizeDiscussion(params: {
  transcript: string;
  objective: string | null | undefined;
  learnerLevel: string | null | undefined;
  materialText: string;
}): Promise<DiscussionSummary> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: buildSummaryPrompt(params) },
      { role: "user", content: `次の議論をまとめてください。\n\n${params.transcript}` },
    ],
    text: { format: zodTextFormat(SummarySchema, "discussion_summary") },
  });
  const parsed = response.output_parsed as DiscussionSummary | null;
  if (!parsed) throw new Error("議論のまとめを作れませんでした。もう一度お試しください。");
  return parsed;
}
