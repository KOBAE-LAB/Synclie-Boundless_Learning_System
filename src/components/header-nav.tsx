"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 画面上部の共通メニュー。「授業一覧」と並ぶ上位のページ(組織・共有ライブラリ・学習ダッシュボード等)
// への移動を、ここにまとめる(以前は、各画面にリンクが散らばって並んでいた)。
// いまの場所が分かるよう、該当の項目を強調する。クライアントJSが必要な理由は、現在のURLを
// 知るため(usePathname)だけ。
export interface NavItem {
  label: string;
  href: string;
  /** href とは別に、この項目の配下として扱うURLの先頭(例: 教科・科目 /series は「授業」の配下) */
  alsoUnder?: string[];
}

/**
 * いまのURLに対応する項目を1つだけ選ぶ(一番長く一致した項目)。「授業」(/learn)と
 * 「学習ダッシュボード」(/learn/dashboard)のように、前の部分が同じ項目があっても、
 * ダッシュボードを開いている時に「授業」まで強調されないようにするため。
 */
export function getActiveHref(pathname: string, items: NavItem[]): string | null {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const matches = items.filter((item) => under(item.href) || (item.alsoUnder ?? []).some(under));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

export function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeHref = getActiveHref(pathname, items);
  return (
    <nav aria-label="メインメニュー" className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? "bg-surface-raised text-ink" : "text-ink-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
