/**
 * AIによるペルソナ案の推薦。授業設定(ねらい・学習者の校種学年・討論の型)と、登録済みの資料の
 * 抜粋から、互いに補い合う擬似メンバーの案をまとめて作る。
 *
 * 作るのは「案」だけで、保存先は下書き(status='draft')。教師が確認・修正して承認する既存の
 * F04の流れに乗せる(AIが一方的にペルソナを決めて使い始めることはしない)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_PERSONA } from "./openai";
import { DISCUSSION_STYLES, isDiscussionStyle, type CourseSettings } from "@/lib/courses/settings";

export const MAX_RECOMMEND_COUNT = 5;
const MAX_MATERIAL_CHARS = 6000;

const PersonaDraftSchema = z.object({
  name: z.string().describe("名前。『ミライさん』『田中さん』のような、短く自然な呼び名だけ(説明的な接頭辞は付けない)"),
  role: z.string().describe("役割(例: クラスメイト、先輩、同僚)"),
  developmentalStage: z.string().describe("発達段階・年齢感(学習者の校種・学年に合わせる)"),
  existingKnowledge: z.string().describe("このペルソナが既に知っていること(資料の範囲を超えない)"),
  tone: z.string().describe("口調(例: 友達言葉、丁寧語)"),
  stancePosition: z.string().describe("立場。議題について、具体的に何を主張・重視する人か"),
  stanceGoal: z.string().describe("目標。学習者との対話で何を引き出したいか"),
  speakingFrequency: z.enum(["控えめ", "普通", "積極的"]),
  teachingDegree: z.enum(["問い返すのみ", "ヒントを出す", "直接説明する"]),
  interventionCondition: z.string().describe("介入の条件(空でもよい)"),
  rationale: z.string().describe("教師に向けた、このペルソナを提案する理由(1〜2文)"),
});

const RecommendationSchema = z.object({
  personas: z.array(PersonaDraftSchema),
});

export type PersonaDraft = z.infer<typeof PersonaDraftSchema>;

/** 名前の先頭に付いた「〜派の」のような説明的な接頭辞を除く(名前は呼び名だけにする)。 */
export function cleanPersonaName(name: string): string {
  const trimmed = name.trim().replace(/^[\s「『(（]+|[\s」』)）]+$/g, "");
  return trimmed.replace(/^.{1,12}派の/, "").trim();
}

export interface RecommendInput {
  course: CourseSettings;
  materialText: string;
  count: number;
  // 既に作ってあるペルソナ(重複を避け、補い合うようにするための手がかり)
  existing: Array<{ name: string; role: string; position: string }>;
  // 教師からの任意のヒント(例: 「反対派の中学生」)
  hint?: string;
}

export function buildRecommendationPrompt(input: RecommendInput): string {
  const { course } = input;
  const style = isDiscussionStyle(course.discussion_style) ? DISCUSSION_STYLES[course.discussion_style] : null;
  const material = input.materialText.trim().slice(0, MAX_MATERIAL_CHARS);

  const lines: string[] = [];
  lines.push(`授業名: ${course.title ?? "(未設定)"}`);
  if (course.subject) lines.push(`教科: ${course.subject}`);
  lines.push(`授業のねらい・議題: ${course.objective || "(未設定。授業名と資料から推測し、立場は一般的な論点に留める)"}`);
  lines.push(`学習者の校種・学年: ${course.learner_level || "(未設定)"}`);
  lines.push(`授業の形式: ${course.mode === "solo_study" ? "独習(まだ分かっていない仲間に自分の言葉で説明する)" : "グループワーク(擬似メンバーと議論する)"}`);
  lines.push(`討論の型: ${style ? style.label : "(未設定)"}`);

  const existing =
    input.existing.length > 0
      ? input.existing.map((p) => `- ${p.name}(${p.role}): ${p.position || "立場未設定"}`).join("\n")
      : "(まだ無い)";

  return `あなたは、討論型の学習を設計する教育の専門家です。次の授業で、学習者と議論する「AI擬似メンバー」を${input.count}人分、提案してください。

# 授業の情報
${lines.join("\n")}

# すでにあるメンバー(重複させず、補い合う関係にする)
${existing}

# 登録済みの資料(抜粋。ここに書かれた範囲を超えた知識を、ペルソナに持たせない)
${material || "(資料はまだ登録されていない)"}

# 設計の指針
- ${style ? style.recommendation : "メンバーが全員同じ意見・同じ役割にならないように、立場と着眼点を変えること。"}
- 学習者の校種・学年に合った年齢感・言葉づかいにする(小学生なら易しく、大学・社会人なら落ち着いた口調など)。
- 立場(stancePosition)は、授業の議題に関して具体的に何を主張・重視する人かが分かる文にする。資料に基づく論点にすること。
- 名前は『ミライさん』『田中さん』のような短い呼び名だけにする。『〜派の』のような説明的な接頭辞は付けない。
- 学習者の考えを代わりに出したり、答えを教えてしまう設計にしない(問い返し・ヒント中心)。
- 既有知識・立場・目標には、「資料が未登録」「授業設定が未入力」など、この提案作業の事情を書かない。ペルソナ本人の設定として自然な文にする(資料が無い場合の既有知識は、学年相応の基本的な知識にとどめる)。
- 立場(stancePosition)・目標(stanceGoal)は、それぞれ1〜2文で簡潔に書く。${input.hint ? `\n\n# 教師からのヒント(できるだけ反映する)\n${input.hint}` : ""}`;
}

export async function recommendPersonaDrafts(input: RecommendInput): Promise<Array<PersonaDraft>> {
  const response = await openai.responses.parse({
    model: MODEL_PERSONA,
    input: [
      { role: "system", content: buildRecommendationPrompt(input) },
      { role: "user", content: `${input.count}人分のペルソナ案を作ってください。` },
    ],
    text: { format: zodTextFormat(RecommendationSchema, "persona_recommendation") },
  });

  const parsed = response.output_parsed as z.infer<typeof RecommendationSchema> | null;
  const drafts = (parsed?.personas ?? [])
    .map((p) => ({ ...p, name: cleanPersonaName(p.name) }))
    .filter((p) => p.name.length > 0)
    .slice(0, input.count);
  if (drafts.length === 0) {
    throw new Error("AIがペルソナ案を返しませんでした。もう一度お試しください。");
  }
  return drafts;
}
