// サインアップ・パスワード変更で共通に使う入力チェック(DBに触れない純粋な関数)。
// 自己登録を公開すると第三者に推測されやすいパスワードが使われうるため、最低限の長さを課す。

import { translatorFor } from "@/lib/i18n/translate";
import type { Lang } from "@/lib/i18n/config";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_NAME_LENGTH = 50;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(password: string, lang: Lang = "ja"): string | null {
  const t = translatorFor(lang);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return t("signup.errPasswordShort", { n: MIN_PASSWORD_LENGTH });
  }
  if (password.length > 200) {
    return t("signup.errPasswordLong");
  }
  return null;
}

export interface SignupFields {
  name: string;
  email: string;
  password: string;
}

// 問題があればエラーメッセージ、無ければ null を返す。email は小文字・前後空白除去の上で使うこと
// (normalizeEmail)。
export function validateSignupFields(fields: SignupFields, lang: Lang = "ja"): string | null {
  const t = translatorFor(lang);
  const name = fields.name.trim();
  if (!name) return t("signup.errName");
  if (name.length > MAX_NAME_LENGTH) return t("signup.errNameLong", { n: MAX_NAME_LENGTH });
  if (!EMAIL_PATTERN.test(fields.email)) return t("signup.errEmail");
  return validatePassword(fields.password, lang);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
