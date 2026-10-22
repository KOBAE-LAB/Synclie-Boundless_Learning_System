// 擬似メンバーごとの「色」。誰の発言かを、吹き出し・映像タイル・名前の色で見分けやすくする。
// 色の定義(CSS)は globals.css の .tone-0 〜 .tone-5。ここでは、どのメンバーにどの色を割り当てるかだけを決める。
//
// 割り当ては、授業内のペルソナを作成順に並べた位置で決める(同じ授業では、いつ見ても同じ人は同じ色。
// 発言したことのあるメンバーの色が、あとから入れ替わらない)。
export const TONE_COUNT = 6;

/** 作成順に並んだペルソナIDの配列から、ID → 色の番号(0〜5)の対応を作る。 */
export function assignPersonaTones(personaIdsInCreationOrder: string[]): Record<string, number> {
  const tones: Record<string, number> = {};
  personaIdsInCreationOrder.forEach((id, index) => {
    tones[id] = index % TONE_COUNT;
  });
  return tones;
}

/** 色の番号に対応するCSSクラス名(色の番号が不明なら、中立の色)。 */
export function toneClass(tone: number | undefined): string {
  return tone === undefined ? "tone-neutral" : `tone-${((tone % TONE_COUNT) + TONE_COUNT) % TONE_COUNT}`;
}

/**
 * アバターが無いときに、丸の中に出す頭文字。先輩型の名前(「2025年度の先輩 ミナト(AI)」)は、先頭が年度の数字なので、
 * 呼び名(ミナト)の頭文字を使う。それ以外は、名前の先頭の文字。
 */
export function personaInitial(name: string): string {
  // 先輩型「2025年度の先輩 ミナト(AI)」・集約型「2025年度のみんな ミライ(AI)」「2025年度のみんな(AI)」
  const archived = name.match(/^(?:\d{4}年度の|前の年度の)?(先輩|みんな)\s*(.*?)(?:[(\uFF08]AI[)\uFF09])?$/);
  return Array.from(archived ? archived[2] || archived[1] : name)[0] ?? "";
}
