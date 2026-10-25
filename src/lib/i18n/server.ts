// サーバー側(ページ・サーバーアクション)で、いまの言語と翻訳関数を得る。
import { cookies, headers } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, LOCALES, isLang, langFromAcceptLanguage, type Lang } from "./config";
import { translatorFor, type Translator } from "./translate";

export async function getLang(): Promise<Lang> {
  try {
    const fromCookie = (await cookies()).get(LANG_COOKIE)?.value;
    if (isLang(fromCookie)) return fromCookie;
    return langFromAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    return DEFAULT_LANG;
  }
}

export async function getT(): Promise<{ t: Translator; lang: Lang }> {
  const lang = await getLang();
  return { t: translatorFor(lang), lang };
}

export function formatDateTime(value: string | number | Date, lang: Lang): string {
  return new Date(value).toLocaleString(LOCALES[lang]);
}
export function formatDate(value: string | number | Date, lang: Lang): string {
  return new Date(value).toLocaleDateString(LOCALES[lang]);
}
/** 「10/25」「Oct 25」のような、月日だけの短い日付(日本時間)。 */
export function formatShortDate(value: string | number | Date, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(value));
}
/** 日本時間の日付(年月日)。ポートフォリオなど、記録の日付に使う。 */
export function formatDateJst(value: string | number | Date, lang: Lang): string {
  return new Date(value).toLocaleDateString(LOCALES[lang], { timeZone: "Asia/Tokyo" });
}
