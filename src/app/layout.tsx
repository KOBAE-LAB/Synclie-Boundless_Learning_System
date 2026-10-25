import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "@fontsource-variable/noto-sans-jp/index.css";
import "./globals.css";
import { auth } from "@/auth";
import { logoutAction } from "./logout-action";
import { stopStudentViewAction } from "./view-as-actions";
import { HeaderNav, type NavItem } from "@/components/header-nav";
import { isViewingAsStudent } from "@/lib/auth/session";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LangProvider } from "@/lib/i18n/client";
import { getT } from "@/lib/i18n/server";
import { dictionaryFor, type Translator } from "@/lib/i18n/translate";

// 日本語UIが中心。Google Fonts(next/font/google)をビルド時に取得するのではなく、npmパッケージ
// @fontsource-variable/noto-sans-jp(Noto Sans JP、OFL)を自サーバーから配信する(外部サービスに依存せず、
// OSによる字形・太さの差も出ない)。文字の範囲ごとに分割されているので、使う文字の分だけが読み込まれる。

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: "Synclie - Boundless Learning System", description: t("meta.description") };
}

export const viewport = {
  // ブラウザのUI(iOSのステータスバー等)もロゴの深紅に合わせる(Synclie - Shareと同じ)。
  themeColor: "#a81c1c",
  width: "device-width",
  initialScale: 1,
};

// 役割ごとの共通メニュー。「授業」と並ぶ上位のページへの移動を、ここにまとめる
// (各画面にリンクが散らばって並ぶのをやめた)。授業の配下のページでは「授業」が強調される。
function navItems(t: Translator): Record<string, NavItem[]> {
  return {
    teacher: [
      { label: t("nav.courses"), href: "/courses", alsoUnder: ["/series"] },
      { label: t("nav.organization"), href: "/organization" },
      { label: t("nav.library"), href: "/library" },
      { label: t("nav.archive"), href: "/archive" },
      { label: t("nav.guide"), href: "/guide" },
    ],
    student: [
      { label: t("nav.lessons"), href: "/learn" },
      { label: t("nav.dashboard"), href: "/learn/dashboard" },
      { label: t("nav.portfolio"), href: "/learn/portfolio" },
      { label: t("nav.myData"), href: "/learn/data" },
      { label: t("nav.join"), href: "/learn/join" },
      { label: t("nav.guide"), href: "/guide" },
    ],
  };
}

const ROLE_HOME_HREF: Record<string, string> = {
  teacher: "/courses",
  student: "/learn",
};

// アプリ全体でここにしかナビゲーションが無い(各ページは個別の「戻る」リンクのみ)。
// ログイン中は常にホームへの導線とログアウトボタンを出す
// (以前はログアウトする手段がUI上に一切無く、NextAuth既定のURLを直接開くしかなかった)。
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const user = session?.user as
    | { name?: string | null; email?: string | null; role?: string }
    | undefined;
  // 管理者が「学習者として表示」(動作確認)中かどうか。中は、全ページの上部に常に表示する。
  const viewingAsStudent = user?.role === "teacher" ? await isViewingAsStudent() : false;
  // 「学習者として表示」中は、メニューも学習者のものにする(教師用のままだと、どこにいるか分かりにくい)。
  const navRole = viewingAsStudent ? "student" : (user?.role ?? "");
  const { t, lang } = await getT();
  const NAV_ITEMS = navItems(t);
  const roleLabel = user?.role === "teacher" || user?.role === "student" || user?.role === "guardian" ? t(`roles.${user.role}`) : null;

  return (
    <html lang={lang} className="h-full">
      <body className="min-h-full flex flex-col font-sans">
        <LangProvider lang={lang} dict={dictionaryFor(lang)}>
        {/* キーボード・スクリーンリーダーの人が、メニューを飛ばして本文へ行けるようにする(Tabの最初に出る)。 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent-fill focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          {t("common.skipToMain")}
        </a>
        {viewingAsStudent && (
          <aside aria-label={t("viewAs.label")} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-warn bg-warn-soft px-4 py-2 text-sm text-warn">
            <span>
              <strong>{t("viewAs.strong")}</strong>
              {t("viewAs.rest")}
            </span>
            <form action={stopStudentViewAction}>
              <button
                type="submit"
                className="rounded-md border border-warn px-2.5 py-1 text-xs font-medium hover:bg-surface"
              >
                {t("viewAs.back")}
              </button>
            </form>
          </aside>
        )}
        {user && (
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-t-[3px] border-line border-t-accent-fill px-4 py-2">
            <Link
              href={ROLE_HOME_HREF[navRole] ?? "/"}
              className="flex items-center gap-2 text-sm font-semibold text-ink"
            >
              <Image src="/logo.png" alt="" width={28} height={28} priority className="rounded-full" />
              Synclie
            </Link>
            {NAV_ITEMS[navRole] && <HeaderNav items={NAV_ITEMS[navRole]} />}
            <div className="flex flex-wrap items-center gap-3">
              <span className="max-w-[12rem] truncate text-xs text-ink-muted">
                {user.name ?? user.email ?? ""}
                {roleLabel ? `(${roleLabel})` : ""}
              </span>
              <Link href="/account/password" className="text-xs text-ink-muted underline underline-offset-2">
                {t("common.changePassword")}
              </Link>
              <LanguageSwitcher lang={lang} label={t("common.language")} />
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-surface"
                >
                  {t("common.logout")}
                </button>
              </form>
            </div>
          </header>
        )}
        {!user && (
          <header className="flex justify-end px-4 pt-2">
            <LanguageSwitcher lang={lang} label={t("common.language")} />
          </header>
        )}
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        </LangProvider>
      </body>
    </html>
  );
}
