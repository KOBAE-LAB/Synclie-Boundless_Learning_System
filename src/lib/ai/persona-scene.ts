/**
 * 複数の擬似メンバーによる「場面」の生成。
 *
 * 学習者の発言のあと、メンバー全員の設定(性格・立場・発言頻度・介入の条件)を一度に渡し、
 * 「いま、その視点から口を出すのが自然な人」だけが、お互いに反応しながら続けて話す短い場面を
 * 1回の呼び出しで作らせる。誰が・何人話すか、AI同士で議論するかも、場面ごとにAIが決める。
 * (以前は、学習者の発言1回につき、必ず1人だけが返答していた)
 *
 * 研究の中核(F20)は保つ:
 *  - 論証評価(新しい根拠の有無)は、この呼び出しとは別に、学習者の発言ごとに独立して行う。
 *  - 各発言に conceded(その発言で立場を譲歩したか)を付けさせ、発言した擬似メンバーごとに記録できる。
 *  - 「根拠が無ければ立場を変えない」原則は、全員に適用する。
 */
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai, MODEL_PERSONA } from "./openai";
import { extractPartialSceneMessages } from "./partial-json";
import { isPersonaMentioned } from "@/lib/persona-mention";
import type { ChatTurn } from "./persona";
import { THINKING_DEPTH_GUIDANCE, type ThinkingDepth } from "@/lib/persona-traits";

export const LIVELINESS = {
  quiet: { label: "控えめ(最大2発言)", maxMessages: 2 },
  normal: { label: "普通(最大3発言)", maxMessages: 3 },
  lively: { label: "活発(最大4発言)", maxMessages: 4 },
} as const;
export type Liveliness = keyof typeof LIVELINESS;

export function maxMessagesFor(liveliness: string | null | undefined): number {
  return liveliness && liveliness in LIVELINESS ? LIVELINESS[liveliness as Liveliness].maxMessages : LIVELINESS.normal.maxMessages;
}

export interface ScenePersona {
  id: string;
  name: string;
  role: string;
  tone: string;
  position: string;
  goal: string;
  speakingFrequency: string;
  teachingDegree: string;
  interventionCondition: string;
  // 考え方の深さ(発言の中身と文量に効く)。返答のテンポは画面での出方だけの設定なので、ここには含めない
  thinkingDepth: ThinkingDepth;
}

export interface SceneMessage {
  personaId: string;
  name: string;
  reply: string;
  conceded: boolean;
}

export interface SceneParams {
  personas: ScenePersona[];
  courseContext?: string;
  materialText: string;
  turnGuidance?: string;
  maxMessages: number;
  // 学習者が名前を挙げたメンバー(必ず最初に答える)
  calledOut: string[];
  // 学習者が少し黙っている間の、擬似メンバーからの継続の場面か
  silence?: boolean;
  // 授業の設定(推論の深さ)。未指定ならモデルの既定。
  reasoningEffort?: "low" | "high";
}

export function buildSceneSystemPrompt(params: SceneParams): string {
  const members = params.personas
    .map(
      (p) => `## ${p.name}
- 役割: ${p.role || "(未設定)"}
- 口調: ${p.tone || "(未設定)"}
- 立場: ${p.position || "(未設定)"}
- 目標: ${p.goal || "(未設定)"}
- 発言頻度: ${p.speakingFrequency || "普通"}
- 教える度合い: ${p.teachingDegree || "問い返すのみ"}
- 介入の条件: ${p.interventionCondition || "(特になし)"}
- 考え方: ${THINKING_DEPTH_GUIDANCE[p.thinkingDepth]}`,
    )
    .join("\n\n");

  const opening = params.silence
    ? "学習者は少し黙っています。擬似メンバーのほうから会話を続ける場面を作ってください(学習者への短い問いかけで終える)。\n" +
      "直前に話したメンバーの発言を、言い換えて繰り返してはいけません。直前に話したメンバー以外から話し始め、" +
      "まだ出ていない視点・ヒント・具体例のどれかを加えること(学習者が答えやすくなるよう、問いを具体的にしてもよい)。"
    : "学習者の直近の発言のあと、擬似メンバーが続けて発言する場面を作ってください。";

  return `あなたは、学習者と複数のAI擬似メンバーによる議論の「場面」を作る脚本家です。${opening}
場面は1〜${params.maxMessages}発言です。

# 参加している擬似メンバー
${members}
${params.courseContext ? `\n# この授業について\n${params.courseContext}\n` : ""}
# 知識源(次の資料の範囲でのみ発言する)
${params.materialText}
${params.turnGuidance ? `\n# 今回の発言に対する補足\n${params.turnGuidance}\n` : ""}
# 誰が話すかの決め方(最も大切)
- 各メンバーの性格・視点・発言頻度・介入の条件から、「いま、この話題に口を出すのが自然な人」だけが話す。
  自分の視点に関わらない話題では、黙っていてよい(全員が毎回話す必要はない)。発言頻度が「控えめ」の人は、本当に必要な時だけ話す。
- ${params.calledOut.length > 0 ? `学習者が名前を挙げた ${params.calledOut.join("、")} は、必ず最初に答える。` : "最初に答えるのは、学習者の発言に最も関わりの深いメンバー。"}
- そのあと、別のメンバーが自分の視点から、補足・疑問・反論を述べてよい。直前に話したメンバーの意見に賛成・反対するときは、
  その人の名前を呼んで直接答える(学習者だけでなく、メンバー同士で議論してよい)。
  (同じ人が2回話してもよいが、同じ人が続けて話すことはしない)。
- 場面の最後の発言は、学習者に話を返す(問いかけ、意見を求める)。AI同士の議論だけで終わらない。
- 自然な長さにする。1発言で足りるなら1発言でよい。最大${params.maxMessages}発言。

# 各メンバーが守ること
- あなたたちはAIである。AIであることは、そのメンバーが会話の中でまだ明かしていなければ、一度だけ自然に明示する(履歴で既に明かしていれば、繰り返さない)。
- 資料に書かれていないことを断定しない。分からないことは「そこは分からない」と述べ、問い返す。
- 学習者の意見にも、他のメンバーの意見にも、根拠なく同調しない。「新しい根拠」または「具体的な事例」が示された時に限り、立場を少し譲歩してよい。それ以外は、自分の立場を保つ。
- 答えを直接教えず、学習者自身に考えさせる問いを混ぜる(「教える度合い」が許す範囲で)。
- 履歴で、自分や他のメンバーが既に述べた内容(同じ問い・同じ指摘)を、言い換えて繰り返さない。新しい観点・根拠・具体的な問いを必ず加える。
- 各発言は、そのメンバーの口調で、そのメンバーの「考え方」に合った長さ(直感的なら短く、じっくり論理的なら少し丁寧に)に収める。

# 出力
- speaker: 上の「参加している擬似メンバー」の名前そのまま
- reply: その発言の本文
- conceded: その発言で、そのメンバーが自分の立場を譲歩・変更したか(していなければ false)`;
}

/**
 * AIの出力を、画面・保存に使える形に整える(純粋関数)。
 *  - 話者名を、参加メンバーに対応づける(完全一致、無ければ末尾一致)。対応づけられないものは捨てる
 *  - 空の発言は捨て、上限(maxMessages)で切る
 *  - 1つも残らなければ、最低1発言は返す(fallback のメンバーが、返答の本文だけでも話す)
 */
export function normalizeSceneMessages(
  raw: Array<{ speaker: string; reply: string; conceded: boolean }>,
  personas: ScenePersona[],
  maxMessages: number,
  fallback: ScenePersona,
): SceneMessage[] {
  const resolve = (name: string): ScenePersona | undefined =>
    personas.find((p) => p.name === name) ?? personas.find((p) => isPersonaMentioned(p.name, name));

  const messages: SceneMessage[] = [];
  for (const m of raw) {
    const persona = resolve(m.speaker);
    const reply = m.reply.trim();
    if (!persona || !reply) continue;
    messages.push({ personaId: persona.id, name: persona.name, reply, conceded: m.conceded === true });
    if (messages.length >= maxMessages) break;
  }
  if (messages.length === 0) {
    const first = raw.map((m) => m.reply.trim()).find((r) => r.length > 0);
    if (first) messages.push({ personaId: fallback.id, name: fallback.name, reply: first, conceded: false });
  }
  return messages;
}

export type LiveSceneMessage = { personaId: string; name: string; text: string };

/**
 * 場面を生成する。届いた分から順に onUpdate へ「ここまでの全メッセージ(話者が確定したもの)」を
 * 渡し、最後に整えた結果を返す。
 */
export async function askScene(
  params: SceneParams,
  history: ChatTurn[],
  fallback: ScenePersona,
  onUpdate?: (messages: LiveSceneMessage[]) => void,
): Promise<SceneMessage[]> {
  const names = params.personas.map((p) => p.name) as [string, ...string[]];
  const SceneSchema = z.object({
    messages: z.array(
      z.object({
        speaker: z.enum(names),
        reply: z.string(),
        conceded: z.boolean(),
      }),
    ),
  });

  const stream = openai.responses.stream({
    model: MODEL_PERSONA,
    input: [{ role: "system", content: buildSceneSystemPrompt(params) }, ...history],
    text: { format: zodTextFormat(SceneSchema, "persona_scene") },
    ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {}),
  });

  let accumulated = "";
  let lastKey = "";
  stream.on("response.output_text.delta", (event) => {
    accumulated += event.delta;
    if (!onUpdate) return;
    const live: LiveSceneMessage[] = [];
    for (const m of extractPartialSceneMessages(accumulated)) {
      if (m.speaker === null) break; // 話者が確定するまで表示しない(誰の発言か分からないため)
      const persona = params.personas.find((p) => p.name === m.speaker);
      if (!persona) break;
      if (m.reply === "" && !m.complete) break;
      live.push({ personaId: persona.id, name: persona.name, text: m.reply });
    }
    const key = JSON.stringify(live);
    if (key !== lastKey) {
      lastKey = key;
      onUpdate(live.slice(0, params.maxMessages));
    }
  });

  const finalResponse = await stream.finalResponse();
  const parsed =
    (finalResponse.output_parsed as z.infer<typeof SceneSchema> | null | undefined) ??
    SceneSchema.parse(JSON.parse(finalResponse.output_text));
  const messages = normalizeSceneMessages(parsed.messages, params.personas, params.maxMessages, fallback);
  // 取りこぼしがあっても、確定した本文を必ず画面に渡す。
  onUpdate?.(messages.map((m) => ({ personaId: m.personaId, name: m.name, text: m.reply })));
  return messages;
}
