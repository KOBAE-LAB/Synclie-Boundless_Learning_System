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
