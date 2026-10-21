import { afterEach, describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { instrumentUsage } from "./openai";
import { setUsageWriterForTest, withAiContext, type UsageEntry } from "./usage";

// OpenAI クライアントの、使用量の記録に関わる部分だけを再現した偽物。
function fakeClient() {
  const listeners: Record<string, (event: unknown) => void> = {};
  return {
    responses: {
      parse: async () => ({ usage: { input_tokens: 100, output_tokens: 20 } }),
      create: async () => ({ usage: { input_tokens: 50, output_tokens: 5 } }),
      stream: () => ({
        on(name: string, cb: (event: unknown) => void) {
          listeners[name] = cb;
          return this;
        },
      }),
    },
    embeddings: { create: async () => ({ usage: { prompt_tokens: 7, total_tokens: 7 } }) },
    emit: (name: string, event: unknown) => listeners[name]?.(event),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("instrumentUsage", () => {
  const written: Array<UsageEntry & { costUsd: number | null }> = [];
  setUsageWriterForTest(async (entry) => {
    written.push(entry);
  });
  afterEach(() => {
    written.length = 0;
  });

  it("parse の結果をそのまま返し、構造化出力の名前と授業回つきで使用量を記録する", async () => {
    const fake = fakeClient();
    const client = instrumentUsage(fake as unknown as OpenAI);
    const result = await withAiContext({ courseId: "c1" }, () =>
      client.responses.parse({ model: "gpt-5.6-luna", input: "x", text: { format: { name: "argument_evaluation" } } } as never),
    );
    await flush();
    expect(result).toEqual({ usage: { input_tokens: 100, output_tokens: 20 } });
    expect(written).toEqual([
      expect.objectContaining({ purpose: "argument_evaluation", model: "gpt-5.6-luna", courseId: "c1" }),
    ]);
  });

  it("ストリームは、完了したときの usage を記録する", async () => {
    const fake = fakeClient();
    const client = instrumentUsage(fake as unknown as OpenAI);
    withAiContext({ purpose: "persona_scene" }, () => client.responses.stream({ model: "gpt-5.6-terra", input: "x" } as never));
    fake.emit("response.completed", { response: { usage: { input_tokens: 4000, output_tokens: 300 } } });
    await flush();
    expect(written).toEqual([expect.objectContaining({ purpose: "persona_scene", model: "gpt-5.6-terra" })]);
  });

  it("埋め込みも記録する", async () => {
    const fake = fakeClient();
    const client = instrumentUsage(fake as unknown as OpenAI);
    await client.embeddings.create({ model: "text-embedding-3-small", input: "x" });
    await flush();
    expect(written).toEqual([expect.objectContaining({ purpose: "embedding", usage: { inputTokens: 7, cachedInputTokens: 0, outputTokens: 0 } })]);
  });
});
