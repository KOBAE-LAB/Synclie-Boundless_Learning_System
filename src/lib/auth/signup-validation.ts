// サインアップ・パスワード変更で共通に使う入力チェック(DBに触れない純粋な関数)。
// 自己登録を公開すると第三者に推測されやすいパスワードが使われうるため、最低限の長さを課す。

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_NAME_LENGTH = 50;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
  }
  if (password.length > 200) {
    return "パスワードが長すぎます。";
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
export function validateSignupFields(fields: SignupFields): string | null {
  const name = fields.name.trim();
  if (!name) return "お名前を入力してください。";
  if (name.length > MAX_NAME_LENGTH) return `お名前は${MAX_NAME_LENGTH}文字以内にしてください。`;
  if (!EMAIL_PATTERN.test(fields.email)) return "メールアドレスの形式が正しくありません。";
  return validatePassword(fields.password);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
