// 辞書(dictionaries/ja.ts が正。en.ts は同じ形でなければ型エラーになる)から、文言を引く。サーバーでもクライアントでも使える純粋関数。
import { ja } from "./dictionaries/ja";
import { en } from "./dictionaries/en";
import type { Lang } from "./config";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type DictKey = Leaves<typeof ja>;
export type Vars = Record<string, string | number>;
export type Translator = (key: DictKey, vars?: Vars) => string;

const DICTIONARIES = { ja, en } as const;

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

/** {name} を値に置き換える。 */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function translatorFor(lang: Lang): Translator {
  return (key, vars) => interpolate(lookup(DICTIONARIES[lang], key) ?? lookup(ja, key) ?? key, vars);
}

export function dictionaryFor(lang: Lang) {
  return DICTIONARIES[lang];
}
