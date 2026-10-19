// ストリーミング中の、まだ閉じていないJSON文字列から、指定したキーの文字列値を
// 「いま届いている分まで」取り出す。擬似メンバーの返答(`{"reply":"...","conceded":false}`)を
// 構造化出力のまま流して、返答本文だけを順次画面に出すために使う。
//
// 完全なJSONパーサーではない: 先頭付近の `"key":"` を探し、閉じ引用符(エスケープされていない
// ")までの文字列を、エスケープを解釈しながら返す。まだ届いていない/切れかけの
// エスケープ(`\` で終わる、`\u00` で終わる等)は、そこまでを返して次回に回す。

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export function extractPartialJsonString(json: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!match) return null;

  let i = match.index + match[0].length;
  let out = "";
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') return out; // 文字列が閉じた
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    // エスケープシーケンス
    const next = json[i + 1];
    if (next === undefined) return out; // `\` で切れている
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out; // まだ4桁届いていない
      const code = parseInt(hex, 16);
      if (Number.isNaN(code)) return out;
      out += String.fromCharCode(code);
      i += 6;
      continue;
    }
    out += SIMPLE_ESCAPES[next] ?? next;
    i += 2;
  }
  return out;
}

/**
 * extractPartialJsonString と同じだが、その文字列が閉じている(値が確定している)かも返す。
 * 話者名のように、途中の断片では使えない値(確定してから使いたい)を扱うため。
 */
export function extractJsonStringWithStatus(json: string, key: string): { value: string; closed: boolean } | null {
  const value = extractPartialJsonString(json, key);
  if (value === null) return null;
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!match) return null;
  // 値の開始位置から、閉じ引用符(エスケープされていない ")が現れているかを調べる
  let i = match.index + match[0].length;
  while (i < json.length) {
    const ch = json[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return { value, closed: true };
    i += 1;
  }
  return { value, closed: false };
}

export interface PartialSceneMessage {
  /** 話者名。値が確定する(文字列が閉じる)まで null */
  speaker: string | null;
  /** 返答本文の、いま届いている分 */
  reply: string;
  /** このメッセージ(JSONのオブジェクト)が最後まで届いたか */
  complete: boolean;
}

/**
 * ストリーミング中の `{"messages":[{"speaker":..,"reply":..,"conceded":..}, ...]}` から、
 * いま届いている分のメッセージを順に取り出す。複数の擬似メンバーが話す「場面」を、
 * 完成を待たずに画面へ流すために使う。文字列の中の括弧・引用符・エスケープは正しく読み飛ばす。
 */
export function extractPartialSceneMessages(json: string): PartialSceneMessage[] {
  const keyAt = json.indexOf('"messages"');
  if (keyAt < 0) return [];
  const arrayAt = json.indexOf("[", keyAt);
  if (arrayAt < 0) return [];

  const messages: PartialSceneMessage[] = [];
  let i = arrayAt + 1;
  while (i < json.length) {
    // 区切り(空白・カンマ)を飛ばす
    while (i < json.length && /[\s,]/.test(json[i])) i += 1;
    if (i >= json.length || json[i] === "]") break;
    if (json[i] !== "{") break;

    // オブジェクトの終わりを探す(文字列の中は無視する)
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < json.length; j++) {
      const ch = json[j];
      if (inString) {
        if (ch === "\\") j += 1;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    const complete = end >= 0;
    const objectText = complete ? json.slice(i, end + 1) : json.slice(i);
    const speaker = extractJsonStringWithStatus(objectText, "speaker");
    messages.push({
      speaker: speaker?.closed ? speaker.value : null,
      reply: extractPartialJsonString(objectText, "reply") ?? "",
      complete,
    });
    if (!complete) break;
    i = end + 1;
  }
  return messages;
}
