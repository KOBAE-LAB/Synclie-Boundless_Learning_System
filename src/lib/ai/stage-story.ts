/**
 * ②抽出層: 段階の物語と軌跡(要件定義書14章ステップ5)。
 *  - buildLiveStageStory: 段階が切り替わったとき、終わった段階のエピソードから「段階の物語(当時版)」を作り、
 *    これまでの軌跡に足して「軌跡の新しい版」を作る(1回の呼び出し)。入力は、その時点までの記録だけ。
 *  - buildRetrospective: 探究の終了後に、全段階を振り返った「段階の物語(振り返り版)」と軌跡を作る(1回の呼び出し)。
 * 軌跡は、先輩型ペルソナのプロンプトに常に入るので、約800字に抑える(要件定義書14章ステップ6の費用の見直し)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";

export const MAX_STAGE_STORY_CHARS = 600;
export const MAX_TRAJECTORY_CHARS = 800;

const LiveSchema = z.object({
  stageStory: z.string().describe(`この段階で何に迷い、何を決めたかの物語。本人の一人称で${MAX_STAGE_STORY_CHARS}字以内`),
  trajectory: z.string().describe(`探究の始まりからこの段階の終わりまでの流れ。本人の一人称で${MAX_TRAJECTORY_CHARS}字以内`),
});

const RetrospectiveSchema = z.object({
  stageStories: z
    .array(z.object({ stageKey: z.string(), story: z.string() }))
    .describe(`段階ごとの振り返り。探究を終えた立場から、本人の一人称で、各${MAX_STAGE_STORY_CHARS}字以内`),
  trajectory: z.string().describe(`探究全体を振り返った流れ。${MAX_TRAJECTORY_CHARS}字以内`),
});

const COMMON_RULES = `- 記録に無いことは補わない。推測で出来事を足さない。
- 人の名前・学校名・地名・クラス名は書かない。AI擬似メンバーは「AIの仲間」と書く。
- 後輩が読んで、自分の探究の参考にできるように、迷いや失敗も隠さずに書く。`;

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function buildLiveStageStory(input: {
  theme: string;
  stageLabel: string;
  episodes: string[];
  previousTrajectory: string;
}): Promise<{ stageStory: string; trajectory: string }> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      {
        role: "system",
        content: `あなたは、探究学習の記録係です。探究の1つの段階が終わりました。その段階の場面(エピソード)から、学習者本人の語りとして記録を残します。

探究のテーマ: ${input.theme || "(未設定)"}
終わった段階: ${input.stageLabel}

書き方:
- この段階が終わった時点の視点で書く。この先どうなるかは、書かない(知らないものとして書く)。
${COMMON_RULES}`,
      },
      {
        role: "user",
        content: `【これまでの軌跡】\n${input.previousTrajectory || "(まだ無い。これが最初の段階)"}\n\n【この段階の場面】\n${input.episodes
          .map((e, i) => `(${i + 1}) ${e}`)
          .join("\n")}`,
      },
    ],
    text: { format: zodTextFormat(LiveSchema, "stage_story") },
  });
  const parsed = response.output_parsed as z.infer<typeof LiveSchema> | null;
  if (!parsed) throw new Error("段階の物語を作れませんでした。");
  return {
    stageStory: clip(parsed.stageStory, MAX_STAGE_STORY_CHARS),
    trajectory: clip(parsed.trajectory, MAX_TRAJECTORY_CHARS),
  };
}

export async function buildRetrospective(input: {
  theme: string;
  stages: { stageKey: string; stageLabel: string; liveStory: string }[];
  lastTrajectory: string;
}): Promise<{ stageStories: { stageKey: string; story: string }[]; trajectory: string }> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      {
        role: "system",
        content: `あなたは、探究学習の記録係です。探究が終わりました。探究を終えた立場から、学習者本人の振り返りとして、段階ごとの物語と全体の流れを書き直します。

探究のテーマ: ${input.theme || "(未設定)"}

書き方:
- 「今思えば、あのときは〜」のように、終えた立場から振り返る。当時の迷いの意味づけを書いてよい。
- stageKey は、下の【段階ごとの記録】に出てくるものだけを使う。
${COMMON_RULES}`,
      },
      {
        role: "user",
        content: `【最後の軌跡】\n${input.lastTrajectory || "(無い)"}\n\n【段階ごとの記録(当時版)】\n${input.stages
          .map((s) => `[${s.stageKey}] ${s.stageLabel}: ${s.liveStory}`)
          .join("\n")}`,
      },
    ],
    text: { format: zodTextFormat(RetrospectiveSchema, "stage_retrospective") },
  });
  const parsed = response.output_parsed as z.infer<typeof RetrospectiveSchema> | null;
  if (!parsed) throw new Error("振り返り版を作れませんでした。");
  const known = new Set(input.stages.map((s) => s.stageKey));
  return {
    stageStories: parsed.stageStories
      .filter((s) => known.has(s.stageKey))
      .map((s) => ({ stageKey: s.stageKey, story: clip(s.story, MAX_STAGE_STORY_CHARS) })),
    trajectory: clip(parsed.trajectory, MAX_TRAJECTORY_CHARS),
  };
}
