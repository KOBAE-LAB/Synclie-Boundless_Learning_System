/**
 * 他の学校の後輩に見せる、特定されにくくしたエピソードの語りを作る(要件定義書14章ステップ6の「他校向けの版」、0049)。
 * 同じ学校向けの語り(narrated)を材料に、学校名・地名・団体名・人名・年度・特定できる出来事や数字を、一般的な言い方に置き換える。
 * 考えの変化・問いの立て方・迷いは残す。1回の呼び出しで、複数の場面をまとめて処理する(費用を抑えるため)。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_JUDGE } from "./openai";
import { MAX_NARRATIVE_CHARS } from "./episode-extraction";

export interface EpisodeToAnonymize {
  id: string;
  header: string;
  body: string;
}

const AnonymizedSchema = z.object({
  episodes: z.array(
    z.object({
      id: z.string().describe("渡された場面のID。そのまま返す"),
      header: z.string().describe("検索用の見出し(1文)。特定されにくい言い方で"),
      body: z.string().describe(`一人称の語り。${MAX_NARRATIVE_CHARS}字以内`),
    }),
  ),
});

export const ANONYMIZE_PROMPT = `あなたは、学習者の探究の記録を、他の学校の後輩に見せる前に、特定されにくくする編集者です。
渡された場面ごとに、見出しと語りを書き直してください。

# 必ず一般的な言い方に置き換えるもの
- 学校名・地名・施設名・団体名・店や会社の名前・人名(「〇〇」と伏せられているものもそのまま「あるお店」「近所の人」のように)
- 年度・日付・人数や金額など、数字から特定できるもの(「3人に聞いた」は「何人かに聞いた」でよい)
- その地域でしか起きないような、特定できる出来事(「去年の台風で〇〇が止まった」は「災害のとき困ったことがあった」)

# 残すもの
- 何に悩み、どう考えを変えたか(問いの変化・仮説を捨てた理由・転機・発見)
- 一人称の語り口

# 守ること
- 元の内容にないことを、付け足さない。
- 語りは${MAX_NARRATIVE_CHARS}字以内。
- 渡された場面のIDを、そのまま返す。`;

/** 返ってきた場面を、渡した場面だけに絞り、長さを整える(純粋関数)。 */
export function normalizeAnonymized(
  returned: { id: string; header: string; body: string }[],
  requested: EpisodeToAnonymize[],
): EpisodeToAnonymize[] {
  const wanted = new Set(requested.map((e) => e.id));
  const seen = new Set<string>();
  const out: EpisodeToAnonymize[] = [];
  for (const r of returned) {
    if (!wanted.has(r.id) || seen.has(r.id)) continue;
    const body = r.body.trim().slice(0, MAX_NARRATIVE_CHARS);
    const header = r.header.trim();
    if (!body || !header) continue;
    seen.add(r.id);
    out.push({ id: r.id, header, body });
  }
  return out;
}

export async function anonymizeEpisodes(episodes: EpisodeToAnonymize[]): Promise<EpisodeToAnonymize[]> {
  if (episodes.length === 0) return [];
  const response = await openai.responses.parse({
    model: MODEL_JUDGE,
    input: [
      { role: "system", content: ANONYMIZE_PROMPT },
      { role: "user", content: episodes.map((e) => `## 場面 ${e.id}\n見出し: ${e.header}\n語り: ${e.body}`).join("\n\n") },
    ],
    text: { format: zodTextFormat(AnonymizedSchema, "episode_anonymize") },
  });
  const parsed = response.output_parsed as z.infer<typeof AnonymizedSchema> | null;
  return parsed ? normalizeAnonymized(parsed.episodes, episodes) : [];
}
