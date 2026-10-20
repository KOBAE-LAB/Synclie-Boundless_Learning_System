import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { auth } from "@/auth";
import { logoutAction } from "./logout-action";
import { stopStudentViewAction } from "./view-as-actions";
import { HeaderNav, type NavItem } from "@/components/header-nav";
import { isViewingAsStudent } from "@/lib/auth/session";

// 日本語UIが中心のため、ビルド時にGoogle Fontsを取得する next/font/google ではなく
// OSの標準フォント(日本語グリフを含む)を使う。オフライン/プロキシ環境でもビルドが安定する。

export const metadata: Metadata = {
  title: "Synclie - Boundless Learning System",
  description: "オンデマンド学習をインタラクティブに、独習を個別最適に。",
};

export const viewport = {
  // ブラウザのUI(iOSのステータスバー等)もロゴの深紅に合わせる(Synclie - Shareと同じ)。
  themeColor: "#a81c1c",
  width: "device-width",
  initialScale: 1,
};

const ROLE_LABELS: Record<string, string> = {
  teacher: "教師",
  student: "生徒",
  guardian: "保護者",
};

// 役割ごとの共通メニュー。「授業」と並ぶ上位のページへの移動を、ここにまとめる
// (各画面にリンクが散らばって並ぶのをやめた)。授業の配下のページでは「授業」が強調される。
const NAV_ITEMS: Record<string, NavItem[]> = {
  teacher: [
    { label: "授業", href: "/courses" },
    { label: "組織", href: "/organization" },
    { label: "共有ライブラリ", href: "/library" },
  ],
  student: [
    { label: "授業", href: "/learn" },
    { label: "学習ダッシュボード", href: "/learn/dashboard" },
    { label: "自分のデータ", href: "/learn/data" },
    { label: "授業に参加", href: "/learn/join" },
  ],
};

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

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {viewingAsStudent && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-warn bg-warn-soft px-4 py-2 text-sm text-warn">
            <span>
              <strong>学習者として表示中</strong>(動作確認。発言・提出は、テスト学習者のデータとして記録されます)
            </span>
            <form action={stopStudentViewAction}>
              <button
                type="submit"
                className="rounded-md border border-warn px-2.5 py-1 text-xs font-medium hover:bg-surface"
              >
                管理者に戻る
              </button>
            </form>
          </div>
        )}
        {user && (
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
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
                {user.role && ROLE_LABELS[user.role] ? `(${ROLE_LABELS[user.role]})` : ""}
              </span>
              <Link href="/account/password" className="text-xs text-ink-muted hover:underline">
                パスワード変更
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-surface"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </header>
        )}
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
