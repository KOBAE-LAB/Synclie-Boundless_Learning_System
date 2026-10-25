import type { Lang } from "@/lib/i18n/config";

/**
 * AIの出力を、画面の言語に合わせるための追記。日本語(既定)では何も足さない。
 * 英語のときだけ、学習者に見せる文章を英語で書かせる(構造化出力の項目名・列挙値はそのまま)。
 * 学習者や教師が入力した内容(資料・発言・ペルソナ名など)は翻訳しない。
 */
export function languageDirective(lang?: Lang): string {
  if (lang !== "en") return "";
  return "\n\n# Output language\nWrite every sentence that the learner will read in natural English, because the learner is using the English interface. Keep field names and enum values exactly as specified. Do not translate names or quoted text taken from the materials or the conversation.";
}
