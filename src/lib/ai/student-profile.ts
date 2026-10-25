/**
 * F09: 学習データ蓄積のうち「学習者プロファイル」の生成。
 *
 * F05〜F08で蓄積した対話ログ・成果・フィードバック・振り返りを要約し、
 * 得意な点・課題・学習履歴の要約を返す。段階2のF11(個別最適化支援)が
 * このプロファイルを参照する想定。点数化はしない(F07と同じ方針: 助言中心)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { languageDirective } from "./language";
import type { Lang } from "@/lib/i18n/config";

const StudentProfileSchema = z.object({
  strengths: z.string().describe("得意な点(2〜3文。具体的な行動や発言に基づく)"),
  challenges: z.string().describe("今後の課題(2〜3文。次に伸ばすとよい点)"),
  summary: z.string().describe("学習履歴の要約(3〜4文。取り組んだ内容の流れが分かるように)"),
});

export type StudentProfileSummary = z.infer<typeof StudentProfileSchema>;

export async function generateStudentProfileSummary(
  activityLog: string,
  lang?: Lang,
): Promise<StudentProfileSummary> {
  const systemPrompt = `あなたは学習者の活動記録から、学習者プロファイルを作成するアシスタントです。
点数や順位は付けず、具体的な得意な点・今後の課題・学習の流れの要約を、教師が次の指導に使える形で書いてください。
記録に無いことを推測で断定しないでください。${languageDirective(lang)}`;

  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `学習者の活動記録:\n${activityLog}` },
    ],
    text: { format: zodTextFormat(StudentProfileSchema, "student_profile") },
  });

  return response.output_parsed as StudentProfileSummary;
}
