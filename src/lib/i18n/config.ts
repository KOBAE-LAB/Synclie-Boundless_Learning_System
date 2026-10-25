// 言語は、日本語(既定)と英語の2つだけ(先生の決定、2026-10-25)。ほかの言語は増やさない。
export const LANGS = ["ja", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "ja";
export const LANG_COOKIE = "synclie_lang";
export const LANG_LABELS: Record<Lang, string> = { ja: "日本語", en: "English" };
/** 日付・数字の書式に使うロケール */
export const LOCALES: Record<Lang, string> = { ja: "ja-JP", en: "en-US" };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/**
 * 最初に訪れた人の言語: Cookieが無いとき、ブラウザの優先言語(Accept-Language)の先頭が英語なら英語、それ以外は日本語。
 * 日本語・英語以外の言語の人には、日本語を出す(アプリの既定)。
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  const first = (header ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  return DEFAULT_LANG;
}
