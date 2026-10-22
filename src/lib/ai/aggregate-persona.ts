/**
 * ③投射層: 集約型ペルソナの下書き(要件定義書14章の実装(2c))。
 * 前の年度の、複数の学習者の記録(軌跡と、匿名化・語り化された場面)から、共通するつまずき・よくある誤解・有効だった問いを
 * 1回の呼び出しでまとめ、「前の年度の学習者の記録をもとにしたAI」の設定を作る。教師が確認・修正して承認するまで使わない。
 * 個人の話ではなく、複数の記録に共通することだけを書かせる(個人が特定されないように)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { clip } from "./stage-story";

const ItemSchema = z.object({
  kind: z.enum(["stumble", "misconception", "good_question"]).describe("stumble=つまずき / misconception=よくある誤解 / good_question=有効だった問い"),
  text: z.string().describe("1文(80字以内)。「多くの人が…」の形で、個人を特定しない"),
  lessonNo: z.number().int().nullable().describe("主に現れた授業回の番号。記録から分からなければ null"),
});

const DraftSchema = z.object({
  role: z.string().describe("後輩から見た、このAIの役割(40字以内)。例: 「去年の多くの人がつまずいた点を知っている仲間」"),
  tone: z.string().describe("話し方(40字以内)"),
  position: z.string().describe("このAIが大事にしている見方(120字以内)。記録に共通して現れていることだけ"),
  goal: z.string().describe("後輩との関わり方(120字以内)。答えを教えず、共通のつまずきを材料に問い返す方向で"),
  items: z.array(ItemSchema).describe("共通するつまずき・誤解・有効だった問い(合わせて最大8件。2人以上の記録に共通するものだけ)"),
});

export type AggregatePersonaDraft = z.infer<typeof DraftSchema>;
export type AggregateItemKind = z.infer<typeof ItemSchema>["kind"];

export async function draftAggregatePersona(input: { subject: string; materials: string }): Promise<AggregatePersonaDraft> {
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      {
        role: "system",
        content: `あなたは、前の年度の複数の学習者の記録から、後輩の学びに伴走する「集約型のAI」の設定を下書きします。
特定の誰かではなく、前の年度の多くの学習者の記録をもとにしたAIです。教師が確認・修正してから使います。

書き方:
- 2人以上の記録に共通して現れることだけをまとめる。1人だけの話は書かない。
- 個人を特定できる書き方をしない(人の名前・学校名・地名・クラス名は書かない)。「多くの人が…」の形にする。
- 記録に書かれていないことを、推測で足さない。
- 答えを教えるのではなく、共通のつまずきを材料に、後輩に問い返す設定にする。`,
      },
      {
        role: "user",
        content: `【科目・テーマ】${input.subject}\n\n【前の年度の学習者の記録(匿名化済みの要約)】\n${input.materials}`,
      },
    ],
    text: { format: zodTextFormat(DraftSchema, "aggregate_persona_draft") },
  });
  const parsed = response.output_parsed as AggregatePersonaDraft | null;
  if (!parsed) throw new Error("集約型のペルソナの下書きを作れませんでした。");
  return {
    role: clip(parsed.role, 40),
    tone: clip(parsed.tone, 40),
    position: clip(parsed.position, 120),
    goal: clip(parsed.goal, 120),
    items: parsed.items.slice(0, 8).map((i) => ({ kind: i.kind, text: clip(i.text, 80), lessonNo: i.lessonNo })),
  };
}
