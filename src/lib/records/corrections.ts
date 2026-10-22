// 発言の修正版(F15、0042の dialogue_turn_corrections)。
// 教師の監査で直した発言は、元の発言(dialogue_turns.content)を書き換えず、修正版を別に持つ
// (生ログは書き換えない、要件定義書14章の設計原則1)。画面の表示と、AIに渡す履歴・まとめ・ジャッジには、
// 最新の修正版を使う(訂正した誤りを、擬似メンバーが繰り返さないように)。
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface CorrectionRow {
  turn_id: string;
  corrected_content: string;
  note: string | null;
  created_at: string;
}

/** 発言ごとに、いちばん新しい修正版だけを残す(純粋関数)。 */
export function pickLatestCorrections(rows: CorrectionRow[]): Map<string, CorrectionRow> {
  const latest = new Map<string, CorrectionRow>();
  for (const row of rows) {
    const current = latest.get(row.turn_id);
    if (!current || row.created_at > current.created_at) latest.set(row.turn_id, row);
  }
  return latest;
}

export async function loadLatestCorrections(admin: AdminClient, turnIds: string[]): Promise<Map<string, CorrectionRow>> {
  if (turnIds.length === 0) return new Map();
  const { data } = await admin
    .from("dialogue_turn_corrections")
    .select("turn_id, corrected_content, note, created_at")
    .in("turn_id", turnIds);
  return pickLatestCorrections((data ?? []) as CorrectionRow[]);
}

/** 発言の本文を、最新の修正版があればそれに差し替えた写しを返す(元の行は変えない)。 */
export function overlayCorrections<T extends { id: string; content: string }>(
  rows: T[],
  corrections: Map<string, CorrectionRow>,
): T[] {
  return rows.map((row) => {
    const correction = corrections.get(row.id);
    return correction ? { ...row, content: correction.corrected_content } : row;
  });
}

export async function applyTurnCorrections<T extends { id: string; content: string }>(
  admin: AdminClient,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  return overlayCorrections(rows, await loadLatestCorrections(admin, rows.map((r) => r.id)));
}
