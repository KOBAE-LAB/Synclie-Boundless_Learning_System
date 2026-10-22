import { afterEach, describe, expect, it } from "vitest";
import {
  currentAiContext,
  estimateCostUsd,
  normalizeUsage,
  purposeFor,
  recordAiUsage,
  setUsageWriterForTest,
  withAiContext,
} from "./usage";

describe("normalizeUsage", () => {
  it("Responses API の usage(キャッシュされた入力を含む)", () => {
    expect(
      normalizeUsage({ input_tokens: 3500, output_tokens: 1500, input_tokens_details: { cached_tokens: 1000 } }),
    ).toEqual({ inputTokens: 3500, cachedInputTokens: 1000, outputTokens: 1500 });
  });
  it("Embeddings API の usage", () => {
    expect(normalizeUsage({ prompt_tokens: 300, total_tokens: 300 })).toEqual({
      inputTokens: 300,
      cachedInputTokens: 0,
      outputTokens: 0,
    });
  });
  it("usage が無ければ null", () => {
    expect(normalizeUsage(undefined)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("要件定義書14章の概算と同じ計算になる(抽出1回: 3,500/1,500 トークンで約 $0.0025)", () => {
    const cost = estimateCostUsd("gpt-5.6-luna", { inputTokens: 3500, cachedInputTokens: 0, outputTokens: 1500 });
    expect(cost).toBeCloseTo(0.0025, 6);
  });
  it("単価が分からないモデルは null", () => {
    expect(estimateCostUsd("unknown-model", { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 })).toBeNull();
  });
});

describe("purposeFor", () => {
  it("明示した用途 → 構造化出力の名前 → APIの種類、の順に決める", () => {
    const params = { text: { format: { name: "persona_reply" } } };
    expect(purposeFor({ purpose: "episode_extraction" }, params, "responses")).toBe("episode_extraction");
    expect(purposeFor({}, params, "responses")).toBe("persona_reply");
    expect(purposeFor({}, {}, "embedding")).toBe("embedding");
  });
});

describe("withAiContext", () => {
  it("入れ子にすると内側が優先され、外では元に戻る", () => {
    withAiContext({ courseId: "c1", purpose: "outer" }, () => {
      withAiContext({ purpose: "inner" }, () => {
        expect(currentAiContext()).toEqual({ courseId: "c1", purpose: "inner" });
      });
      expect(currentAiContext().purpose).toBe("outer");
    });
    expect(currentAiContext()).toEqual({});
  });
});

describe("recordAiUsage", () => {
  afterEach(() => setUsageWriterForTest(async () => undefined));

  it("記録に失敗しても例外を投げない(AIの呼び出しを止めない)", async () => {
    setUsageWriterForTest(async () => {
      throw new Error("relation ai_usage_log does not exist");
    });
    await expect(
      recordAiUsage({ purpose: "x", model: "gpt-5.6-luna", usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 } }),
    ).resolves.toBeUndefined();
  });
  it("金額の目安を付けて書き込む", async () => {
    const written: unknown[] = [];
    setUsageWriterForTest(async (entry) => {
      written.push(entry);
    });
    await recordAiUsage({ purpose: "x", model: "gpt-5.6-terra", usage: { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0 } });
    expect(written).toEqual([expect.objectContaining({ purpose: "x", costUsd: 2 })]);
  });
});
