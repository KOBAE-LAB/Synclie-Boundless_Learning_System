/**
 * ②抽出層: 1つの議論から「探究のエピソード」を取り出す(要件定義書14章ステップ5)。
 * 費用を抑えるため、場面の抽出・匿名化・一人称の語りを、1回の呼び出しでまとめて行う。
 *  - 原文の抜粋はAIに書かせない(発言の範囲 startTurn〜endTurn だけを返させ、アプリが発言から切り出す)
 *  - 語りは「当時の自分」の一人称。その議論より後のことは書かない(当時モードの先取りを防ぐ)
 *  - 語りは匿名化する(人名・学校名・地名を書かない)。さらにアプリ側で、名簿にある名前を機械的に伏せる
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";

/** エピソードの種類(ステップ2の決定)。実データを見て増減する。 */
export const EPISODE_TYPES = {
  question_shift: "問いの変化",
  hypothesis_rejected: "仮説の棄却",
  stuck: "行き詰まり",
  turning_point: "転機",
  discovery: "発見",
} as const;

export type EpisodeType = keyof typeof EPISODE_TYPES;

/** 1議論から作るエピソードの上限と、語りの長さの上限(出力の単価が高いため、長さが費用を左右する) */
export const MAX_EPISODES_PER_SESSION = 3;
export const MAX_NARRATIVE_CHARS = 400;

const ExtractionSchema = z.object({
  episodes: z
    .array(
      z.object({
        type: z.enum(Object.keys(EPISODE_TYPES) as [EpisodeType, ...EpisodeType[]]),
        startTurn: z.number().int().describe("場面の最初の発言の番号([T3]なら3)"),
        endTurn: z.number().int().describe("場面の最後の発言の番号"),
        contextHeader: z
          .string()
          .describe("検索用の見出し。『〇〇をテーマにした探究の、課題の設定の段階で、最初の問いを広すぎると気づいた場面』のように1文で"),
        narrative: z
          .string()
          .describe(`その場面を、当時の学習者本人の一人称(「自分は」「私たちは」)で語った文章。${MAX_NARRATIVE_CHARS}字以内`),
      }),
    )
    .describe(`大事な場面だけ。最大${MAX_EPISODES_PER_SESSION}件。無ければ空の配列`),
});

export interface ExtractedEpisode {
  type: EpisodeType;
  startTurn: number;
  endTurn: number;
  contextHeader: string;
  narrative: string;
}

export interface ExtractionInput {
  theme: string;
  stageLabel: string;
  /** [T1] 学習者: …… の形の書き起こし(番号は1から) */
  transcript: string;
  /** 印の付いた発言の番号と、印の種類の説明 */
  markedTurns: { turn: number; reason: string }[];
  /** 振り返りの「迷ったこと」など(無ければ空) */
  reflectionText: string;
  /** その時点までの軌跡(無ければ空)。語りが軌跡と食い違わないように参考にする */
  trajectorySoFar: string;
  /** すでにエピソードにした発言の範囲(作り直しや、後から印が付いたときの重複を避ける) */
  alreadyCovered: { startTurn: number; endTurn: number }[];
}

export function buildExtractionPrompt(input: ExtractionInput): string {
  const types = Object.entries(EPISODE_TYPES)
    .map(([key, label]) => `- ${key}: ${label}`)
    .join("\n");
  return `あなたは、探究学習の記録係です。学習者とAI擬似メンバーの議論の記録から、後輩の探究の参考になる「大事な場面」を選び、学習者本人の語りとして書き残します。

探究のテーマ: ${input.theme || "(未設定)"}
この議論のときの探究の段階: ${input.stageLabel}

場面の種類:
${types}

選び方:
- 印の付いた発言を含む場面を優先する(印は、考えが動いた瞬間や、本人・教師が「残したい」と選んだ発言)。
- 考えや問いが実際に動いた場面だけを選ぶ。ただの雑談や、同じことの繰り返しは選ばない。最大${MAX_EPISODES_PER_SESSION}件。無理に件数を埋めない。
- すでにエピソードにした範囲とは重ならないようにする。

語りの書き方:
- 当時の学習者本人の一人称で、「何に迷い、何をきっかけに、どう考えが変わったか(または変わらなかったか)」を書く。${MAX_NARRATIVE_CHARS}字以内。
- この議論より後に何が起きたかは、書かない(知らないものとして書く)。結論を先取りしない。
- 記録に無いことは補わない。推測で出来事を足さない。
- 人の名前・学校名・地名・クラス名は書かない(「自分」「メンバー」「AIの○○役」などに言い換える)。
- AI擬似メンバーの発言は「AIの仲間が〜と言った」のように、AIであることが分かる書き方にする。`;
}

export function buildExtractionUserMessage(input: ExtractionInput): string {
  const marked = input.markedTurns.length > 0
    ? input.markedTurns.map((m) => `[T${m.turn}] ${m.reason}`).join("\n")
    : "(なし)";
  const covered = input.alreadyCovered.length > 0
    ? input.alreadyCovered.map((c) => `T${c.startTurn}〜T${c.endTurn}`).join("、")
    : "(なし)";
  return `【この時点までの探究の軌跡】
${input.trajectorySoFar || "(まだ無い)"}

【印の付いた発言】
${marked}

【すでにエピソードにした範囲】
${covered}

【振り返りで書いたこと】
${input.reflectionText || "(なし)"}

【議論の記録】
${input.transcript}`;
}

/** AIの返答を、発言の番号の範囲・件数・文字数の約束に収める(純粋関数)。 */
export function normalizeExtractedEpisodes(
  episodes: ExtractedEpisode[],
  turnCount: number,
  alreadyCovered: { startTurn: number; endTurn: number }[],
): ExtractedEpisode[] {
  const result: ExtractedEpisode[] = [];
  for (const e of episodes) {
    const start = Math.max(1, Math.min(e.startTurn, e.endTurn));
    const end = Math.min(turnCount, Math.max(e.startTurn, e.endTurn));
    if (start > turnCount || end < 1 || start > end) continue;
    const overlaps = [...alreadyCovered, ...result].some((c) => start <= c.endTurn && c.startTurn <= end);
    if (overlaps) continue;
    const narrative = e.narrative.trim();
    if (!narrative) continue;
    result.push({
      ...e,
      startTurn: start,
      endTurn: end,
      contextHeader: e.contextHeader.trim(),
      narrative: narrative.length > MAX_NARRATIVE_CHARS ? `${narrative.slice(0, MAX_NARRATIVE_CHARS - 1)}…` : narrative,
    });
    if (result.length >= MAX_EPISODES_PER_SESSION) break;
  }
  return result;
}

export async function extractEpisodes(input: ExtractionInput, turnCount: number): Promise<ExtractedEpisode[]> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: buildExtractionPrompt(input) },
      { role: "user", content: buildExtractionUserMessage(input) },
    ],
    text: { format: zodTextFormat(ExtractionSchema, "episode_extraction") },
  });
  const parsed = response.output_parsed as z.infer<typeof ExtractionSchema> | null;
  if (!parsed) return [];
  return normalizeExtractedEpisodes(parsed.episodes, turnCount, input.alreadyCovered);
}
