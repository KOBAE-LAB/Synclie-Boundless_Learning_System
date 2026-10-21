// F05: 学習者の発言に関連する資料チャンクを、授業RAG(material_chunks)から検索する。
// F02で作った知識ベースを、実際の対話でペルソナの「知識源」として使う部分。
// 発言の埋め込みは、先輩型ペルソナの記録の検索(src/lib/inquiry/senior-memory.ts)と共用する(呼び出しを増やさない)。

import { openai, MODEL_EMBEDDING } from "@/lib/ai/openai";
import { createAdminClient } from "@/lib/supabase/server";

const DEFAULT_MATCH_COUNT = 5;

interface MatchedChunk {
  id: string;
  content: string;
  similarity: number;
}

/** 発言の埋め込み(教材の検索と、先輩の記録の検索で共用する)。 */
export async function embedQuery(queryText: string): Promise<number[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: MODEL_EMBEDDING,
    input: queryText,
  });
  return embeddingResponse.data[0].embedding;
}

export async function searchMaterialChunksByEmbedding(
  courseId: string,
  queryEmbedding: number[],
  matchCount: number = DEFAULT_MATCH_COUNT,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("match_material_chunks", {
    p_course_id: courseId,
    p_query_embedding: queryEmbedding,
    p_match_count: matchCount,
  });

  if (error) {
    throw new Error(`資料の検索に失敗しました: ${error.message}`);
  }

  return ((data ?? []) as MatchedChunk[]).map((row) => row.content);
}

export async function searchMaterialChunks(
  courseId: string,
  queryText: string,
  matchCount: number = DEFAULT_MATCH_COUNT,
): Promise<string[]> {
  return searchMaterialChunksByEmbedding(courseId, await embedQuery(queryText), matchCount);
}
