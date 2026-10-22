// AIの使用量の記録(0043の ai_usage_log、要件定義書14章「使用量の記録と上限」・12章「コスト上限の監視」)。
// OpenAIの応答に含まれる実際のトークン数を、呼び出しごとに記録する。記録は openai.ts のクライアントが
// 自動で行う(呼び出し側を書き換えなくてよい)。用途は、構造化出力の名前(zodTextFormat の第2引数)から
// 自動で付く。授業回や用途を明示したいときは withAiContext() で囲む。
// 記録の失敗は、AIの呼び出し自体を決して止めない(計測は付加情報のため)。
import { AsyncLocalStorage } from "node:async_hooks";

export interface AiContext {
  /** 用途の名前(例: "episode_extraction")。無ければ構造化出力の名前を使う */
  purpose?: string;
  courseId?: string | null;
  projectId?: string | null;
}

const storage = new AsyncLocalStorage<AiContext>();

/** fn の中で行うAIの呼び出しに、用途・授業回などの文脈を付ける(入れ子にすると内側が優先)。 */
export function withAiContext<T>(context: AiContext, fn: () => T): T {
  return storage.run({ ...(storage.getStore() ?? {}), ...context }, fn);
}

export function currentAiContext(): AiContext {
  return storage.getStore() ?? {};
}

export interface UsageNumbers {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Responses API(input_tokens/output_tokens)と Embeddings API(prompt_tokens)の usage を、同じ形にそろえる。 */
export function normalizeUsage(usage: unknown): UsageNumbers | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if ("input_tokens" in u || "output_tokens" in u) {
    const details = (u.input_tokens_details ?? {}) as Record<string, unknown>;
    return {
      inputTokens: num(u.input_tokens),
      cachedInputTokens: num(details.cached_tokens),
      outputTokens: num(u.output_tokens),
    };
  }
  if ("prompt_tokens" in u) {
    return { inputTokens: num(u.prompt_tokens), cachedInputTokens: 0, outputTokens: 0 };
  }
  return null;
}

/**
 * 100万トークンあたりの単価(米ドル)。金額は画面に出す「目安」で、請求額そのものではない。
 * 出典: 2026-10-20時点の公開価格(要件定義書14章の費用の概算と同じ)。モデルや価格が変わったらここを直す。
 * キャッシュされた入力の単価が分からないモデルは、通常の入力と同じ単価で数える(多めに見積もる側)。
 */
export const PRICES_PER_MILLION_USD: Record<string, { input: number; cachedInput?: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** 金額の目安(米ドル)。単価が分からないモデルは null。 */
export function estimateCostUsd(model: string, usage: UsageNumbers): number | null {
  const price = PRICES_PER_MILLION_USD[model];
  if (!price) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cachedPrice = price.cachedInput ?? price.input;
  return (uncached * price.input + usage.cachedInputTokens * cachedPrice + usage.outputTokens * price.output) / 1_000_000;
}

/** 呼び出しの引数から用途を決める: 明示した文脈 → 構造化出力の名前 → API の種類。 */
export function purposeFor(context: AiContext, params: unknown, fallback: string): string {
  if (context.purpose) return context.purpose;
  const format = (params as { text?: { format?: { name?: unknown } } } | null)?.text?.format?.name;
  return typeof format === "string" && format ? format : fallback;
}

export interface UsageEntry {
  purpose: string;
  model: string;
  usage: UsageNumbers;
  courseId?: string | null;
  projectId?: string | null;
}

type UsageWriter = (entry: UsageEntry & { costUsd: number | null }) => Promise<void>;

// DBへの書き込みは差し替えられるようにしておく(テストでは偽物にする)。既定は Supabase の ai_usage_log。
let writer: UsageWriter = async (entry) => {
  const { createAdminClient } = await import("@/lib/supabase/server");
  const { error } = await createAdminClient().from("ai_usage_log").insert({
    purpose: entry.purpose,
    model: entry.model,
    input_tokens: entry.usage.inputTokens,
    cached_input_tokens: entry.usage.cachedInputTokens,
    output_tokens: entry.usage.outputTokens,
    cost_usd: entry.costUsd,
    course_id: entry.courseId ?? null,
    project_id: entry.projectId ?? null,
  });
  if (error) throw new Error(error.message);
};

export function setUsageWriterForTest(next: UsageWriter) {
  writer = next;
}

/** 使用量を1件記録する。失敗しても例外を投げない。 */
export async function recordAiUsage(entry: UsageEntry): Promise<void> {
  try {
    await writer({ ...entry, costUsd: estimateCostUsd(entry.model, entry.usage) });
  } catch (err) {
    console.error("[ai-usage] 使用量を記録できませんでした", err);
  }
}
