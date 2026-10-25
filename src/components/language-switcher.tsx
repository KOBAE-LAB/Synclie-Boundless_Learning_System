import { setLangAction } from "@/lib/i18n/actions";
import { LANGS, LANG_LABELS, type Lang } from "@/lib/i18n/config";

// 言語の切り替え(日本語 / English)。押すとCookieに保存して、全ページに反映する。ログインしていない画面にも出す。
export function LanguageSwitcher({ lang, label, className = "" }: { lang: Lang; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`flex items-center gap-1 text-xs ${className}`}>
      {LANGS.map((l) => (
        <form key={l} action={setLangAction.bind(null, l)}>
          <button
            type="submit"
            lang={l}
            aria-pressed={l === lang}
            className={`rounded-md px-2 py-1 font-medium ${
              l === lang ? "bg-surface-raised text-ink ring-1 ring-line" : "text-ink-muted underline underline-offset-2 hover:text-ink"
            }`}
          >
            {LANG_LABELS[l]}
          </button>
        </form>
      ))}
    </div>
  );
}
