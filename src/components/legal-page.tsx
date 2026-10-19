import Link from "next/link";
import type { ReactNode } from "react";

// プライバシーポリシー・利用規約に共通の枠。ログインしていなくても読めるようにする
// (Googleのアプリ公開の審査でも、誰でも開ける公開ページであることが求められる)。
export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-xs text-ink-faint">最終更新日: {updatedAt}</p>
      <div className="mt-8 space-y-8 text-sm leading-7 text-ink-muted">{children}</div>
      <nav className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-6 text-sm text-ink-muted">
        <Link href="/privacy" className="hover:underline">
          プライバシーポリシー
        </Link>
        <Link href="/terms" className="hover:underline">
          利用規約
        </Link>
        <Link href="/" className="hover:underline">
          トップへ戻る
        </Link>
      </nav>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{heading}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
