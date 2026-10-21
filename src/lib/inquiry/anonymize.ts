// 匿名化の機械的な確認(要件定義書14章ステップ5の処理段3、AIなし)。
// AIに「名前を書かない」と指示したうえで、名簿にある名前(学習者・教師の表示名、組織名)が残っていれば伏せる。
// 2文字未満の名前は、ふつうの言葉と区別できないので対象にしない。

const MASK = "〇〇";

/** 姓と名が空白で区切られていれば、それぞれも伏せる対象にする(「山田 太郎」→「山田 太郎」「山田」「太郎」)。 */
export function nameVariants(names: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const raw of names) {
    const name = (raw ?? "").trim();
    if (name.length < 2) continue;
    set.add(name);
    for (const part of name.split(/[\s　]+/)) if (part.length >= 2) set.add(part);
    set.add(name.replace(/[\s　]+/g, ""));
  }
  // 長い名前から先に伏せる(「山田太郎」を先に伏せないと「山田」だけが伏せられて「〇〇太郎」になる)
  return [...set].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
}

export function maskNames(text: string, names: (string | null | undefined)[]): string {
  let result = text;
  for (const name of nameVariants(names)) {
    result = result.split(name).join(MASK);
  }
  return result;
}
