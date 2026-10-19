/**
 * AI擬似メンバー(ペルソナ)の対話生成(要件定義書 5章)。
 *
 * ペルソナは4要素で構成される:
 *  - プロフィール(名前・役割・口調)
 *  - 知識源(RAGで取得した教材の範囲。資料にないことは断定しない)
 *  - 立場と目標(対立する立場を代表することもある。例: 見取り重視 vs エビデンス重視)
 *  - 行動ルール(共通のガードレール: AI明示・資料限定・同調禁止・問い返し 等)
 *
 * 同調(学習者に安易に合わせること)を避けるため、新しい根拠または具体例を
 * 伴わない限り、ペルソナは自分の立場を保つ。この判定は argument-evaluation.ts の
 * 「論証評価」を使う(F20)。askPersona は返答本文に加えて、その返答で実際に
 * 譲歩したか(conceded)を自己申告させる。これを論証評価の has_new_evidence と
 * 突き合わせることで、「根拠なく同調したか」を記録できる。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_PERSONA } from "./openai";
import { extractPartialJsonString } from "./partial-json";

export interface PersonaProfile {
  name: string;
  role: string;
  tone: string;
  stance: string;
  materialText: string;
  // F03/F04で教師が設定した、このペルソナ固有の行動ルール(発言頻度、教える度合い、介入の条件など)。
  // 未設定なら省略可(COMMON_GUARDRAILSのみが適用される)。
  behaviorNotes?: string;
  // F20: この1ターンだけの動的な補足(例: 論証評価による「新しい根拠の有無」の判定結果)。
  // persona自体の設定ではないため behaviorNotes とは別枠にしている。
  turnGuidance?: string;
  // 複数の擬似メンバーが同じ授業にいる場合、他のメンバーの名前・立場を伝える。
  // 会話履歴上は他メンバーの発言もrole:"assistant"になり自分の発言と区別できないため、
  // 「誰が他にいて何を主張しているか」を明示しないと反論が機能しない。
  otherParticipants?: string;
  // 授業設定(ねらい・学習者の校種学年・討論の型)から組み立てた、この授業の文脈
  // (src/lib/courses/settings.ts の buildCourseContext)。未設定なら省略。
  courseContext?: string;
}

export const COMMON_GUARDRAILS = `
# 行動ルール(共通のガードレール)
- あなたはAIであることを、対話のどこかで一度は明示する(履歴で既に明かしていれば、繰り返さない)。
- 資料に書かれていないことを断定しない。資料にない問いを聞かれたら「そこは分からない」と述べ、
  学習者に問い返す。
- 学習者の意見に安易に同調しない。学習者の主張が「新しい根拠」または「具体的な事例」を含む場合に
  限り、自分の立場を少し譲歩してよい。それ以外は自分の立場を保つ。
- 他の擬似メンバーの発言にも同様に、根拠なく同調しない。あなたと異なる立場のメンバーがいれば、
  必要に応じて名前を挙げて反論してよい。
- 答えを直接教えず、学習者自身に考えさせる問いを混ぜる。
- 1回の発言は3〜4文程度に収める。
`;

export function buildPersonaSystemPrompt(persona: PersonaProfile): string {
  return `あなたはAIによる擬似的な議論相手・学習仲間です。

# プロフィール
- 名前: ${persona.name}
- 役割: ${persona.role}
- 口調: ${persona.tone}

${persona.courseContext ? `\n# この授業について\n${persona.courseContext}\n` : ""}
# 知識源(次の資料の範囲でのみ発言する)
${persona.materialText}

# 立場と目標
${persona.stance}
${persona.otherParticipants ? `\n# この対話にいる他の擬似メンバー\n${persona.otherParticipants}\n(会話履歴では、あなた以外のメンバーの発言も同じ役割で渡ってくるため、\n発言の先頭に付いている名前で誰の発言かを見分けること。名前が無ければ学習者の発言。)\n` : ""}${persona.behaviorNotes ? `\n# このペルソナ固有の行動ルール\n${persona.behaviorNotes}\n` : ""}${persona.turnGuidance ? `\n# 今回の発言に対する補足\n${persona.turnGuidance}\n` : ""}${COMMON_GUARDRAILS}`;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

const PersonaReplySchema = z.object({
  reply: z.string().describe("学習者への返答本文(自然な会話文、3〜4文程度)"),
  conceded: z
    .boolean()
    .describe("この返答で、直前の学習者の発言を理由に自分の立場を譲歩・変更したか"),
});

export interface PersonaReply {
  reply: string;
  conceded: boolean;
}

export async function askPersona(
  persona: PersonaProfile,
  history: ChatTurn[],
): Promise<PersonaReply> {
  const response = await openai.responses.parse({
    model: MODEL_PERSONA,
    input: [
      { role: "system", content: buildPersonaSystemPrompt(persona) },
      ...history,
    ],
    text: { format: zodTextFormat(PersonaReplySchema, "persona_reply") },
  });

  return response.output_parsed as PersonaReply;
}

/**
 * askPersona()のストリーミング版。構造化出力({reply, conceded})のまま生成させ、
 * 届いた分の返答本文(reply)を onReplyText に「ここまでの全文」として順次渡す
 * (画面側は受け取った全文でそのまま置き換えればよい)。最終的な結果は askPersona() と同じ。
 */
export async function askPersonaStream(
  persona: PersonaProfile,
  history: ChatTurn[],
  onReplyText: (replySoFar: string) => void,
): Promise<PersonaReply> {
  const stream = openai.responses.stream({
    model: MODEL_PERSONA,
    input: [
      { role: "system", content: buildPersonaSystemPrompt(persona) },
      ...history,
    ],
    text: { format: zodTextFormat(PersonaReplySchema, "persona_reply") },
  });

  let accumulated = "";
  let lastSent = "";
  stream.on("response.output_text.delta", (event) => {
    accumulated += event.delta;
    const partial = extractPartialJsonString(accumulated, "reply");
    if (partial !== null && partial !== lastSent) {
      lastSent = partial;
      onReplyText(partial);
    }
  });

  const finalResponse = await stream.finalResponse();
  const parsed =
    (finalResponse.output_parsed as PersonaReply | null | undefined) ??
    PersonaReplySchema.parse(JSON.parse(finalResponse.output_text));
  // 取りこぼしがあっても、最後に確定した本文を必ず画面に渡す。
  if (parsed.reply !== lastSent) onReplyText(parsed.reply);
  return parsed;
}
