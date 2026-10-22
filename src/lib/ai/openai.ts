import OpenAI from "openai";
import { currentAiContext, normalizeUsage, purposeFor, recordAiUsage, type AiContext } from "./usage";

/**
 * OpenAI クライアントのシングルトン。
 * サーバー専用(Route Handler / Server Action)でのみ import すること。
 * 環境変数 OPENAI_API_KEY が必要。
 *
 * 生成は実際に使う瞬間まで遅延させる(Proxy越し)。即座に `new OpenAI()` すると、
 * このモジュールをたどり着けるだけのファイル(actions.ts 経由など)を import した
 * ページを `next build` がビルド時に評価した際、OPENAI_API_KEY が無い環境
 * (ローカルのビルド確認、CIなど)でビルド自体が失敗してしまう。
 */
let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (!client) {
    client = instrumentUsage(new OpenAI());
  }
  return client;
}

/**
 * 使用量の記録(src/lib/ai/usage.ts)。responses.parse / create / stream と embeddings.create の結果から
 * 実際のトークン数を取り、ai_usage_log に記録する。呼び出し側に返すものは元のまま変えない
 * (記録は脇で行い、失敗しても呼び出しには影響しない)。文脈(用途・授業回)は、呼び出した瞬間のものを使う。
 */
export function instrumentUsage(c: OpenAI): OpenAI {
  const log = (context: AiContext, params: unknown, fallback: string, usage: unknown) => {
    const numbers = normalizeUsage(usage);
    const model = (params as { model?: unknown } | null)?.model;
    if (!numbers || typeof model !== "string") return;
    void recordAiUsage({
      purpose: purposeFor(context, params, fallback),
      model,
      usage: numbers,
      courseId: context.courseId,
      projectId: context.projectId,
    });
  };
  const afterResult = (promise: unknown, context: AiContext, params: unknown, fallback: string) => {
    if (promise && typeof (promise as Promise<unknown>).then === "function") {
      (promise as Promise<{ usage?: unknown } | null>).then(
        (result) => log(context, params, fallback, result?.usage),
        () => undefined,
      );
    }
  };

  // SDKの responses.parse は、内部で responses.create を同期的に呼ぶ(その結果を _thenUnwrap で包み直す)。
  // create の結果に先に .then を付けると、包み直した側がもう一度応答の本文を読んで、
  // 「Body is unusable: Body has already been read」で失敗する(2026-10-22に見つかった)。
  // そのため、parse の中から呼ばれた create には付けず、parse の最終的な結果にだけ付ける(記録も1回になる)。
  let parseDepth = 0;
  const responses = c.responses;
  const parse = responses.parse.bind(responses);
  responses.parse = ((params: Parameters<typeof parse>[0], options?: Parameters<typeof parse>[1]) => {
    const context = currentAiContext();
    parseDepth++;
    let result: ReturnType<typeof parse>;
    try {
      result = parse(params, options);
    } finally {
      parseDepth--;
    }
    afterResult(result, context, params, "responses");
    return result;
  }) as typeof responses.parse;

  const create = responses.create.bind(responses) as (...args: unknown[]) => unknown;
  responses.create = ((params: unknown, options?: unknown) => {
    const context = currentAiContext();
    const result = create(params, options);
    if (parseDepth === 0 && !(params as { stream?: unknown } | null)?.stream) afterResult(result, context, params, "responses");
    return result;
  }) as unknown as typeof responses.create;

  const stream = responses.stream.bind(responses);
  responses.stream = ((params: Parameters<typeof stream>[0], options?: Parameters<typeof stream>[1]) => {
    const context = currentAiContext();
    const s = stream(params, options);
    s.on("response.completed", (event) => log(context, params, "responses", event.response.usage));
    return s;
  }) as typeof responses.stream;

  const embeddings = c.embeddings;
  const embed = embeddings.create.bind(embeddings);
  embeddings.create = ((params: Parameters<typeof embed>[0], options?: Parameters<typeof embed>[1]) => {
    const context = currentAiContext();
    const result = embed(params, options);
    afterResult(result, context, params, "embedding");
    return result;
  }) as typeof embeddings.create;

  return c;
}
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
});

// 呼び出し頻度の高い軽い判定(論証評価)は安価なモデル、
// 対話生成(ペルソナ)はやや上位のモデルを使う想定(要件定義書 10章「コスト」参照)。
// 費用を見ながら、実際に使えるモデル名に随時入れ替えること。
export const MODEL_PERSONA = process.env.SYNCLIE_MODEL_PERSONA ?? "gpt-5.6-terra";
export const MODEL_JUDGE = process.env.SYNCLIE_MODEL_JUDGE ?? "gpt-5.6-luna";

// F02(RAG生成)の埋め込みモデル。次元数は supabase/migrations の
// material_chunks.embedding (vector(1536)) と一致させること。
export const MODEL_EMBEDDING = process.env.SYNCLIE_MODEL_EMBEDDING ?? "text-embedding-3-small";

// F13(音声入力)の文字起こしモデル。呼び出し頻度を抑えられないため、
// 安価なモデルをデフォルトにしておく(要件定義書10章「コスト」)。
export const MODEL_TRANSCRIBE = process.env.SYNCLIE_MODEL_TRANSCRIBE ?? "gpt-4o-mini-transcribe";
