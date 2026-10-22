import Link from "next/link";

// 画面の「いまの場所」と「戻る」を、全画面で同じ形に統一する部品。
//
// trail は、いまの画面の祖先を、上位から順に並べたもの(最後が、直接の親=「戻る」先)。
//   例: 授業一覧 › 光合成 › (いま)ペルソナ設定  →  trail=[{授業一覧}, {光合成}], current="ペルソナ設定"
// 左に「← 光合成に戻る」(直接の親へ)、続けてパンくず全体を出す。長い画面では、画面の下にも
// <BackLink> を置いて、最後まで読んだあとに上まで戻らなくてよいようにする。
export interface Crumb {
  label: string;
  href: string;
}

export function Breadcrumbs({ trail, current }: { trail: Crumb[]; current: string }) {
  const parent = trail[trail.length - 1];
  return (
    <nav aria-label="現在の場所" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {parent && (
        <Link
          href={parent.href}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
        >
          <span aria-hidden="true">←</span>
          <span className="truncate">{parent.label}に戻る</span>
        </Link>
      )}
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-faint">
        {trail.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1.5">
            <Link href={crumb.href} className="max-w-[12rem] truncate hover:text-ink hover:underline">
              {crumb.label}
            </Link>
            <span aria-hidden="true">›</span>
          </li>
        ))}
        <li aria-current="page" className="max-w-[14rem] truncate font-medium text-ink-muted">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/** 長い画面の最後に置く「戻る」。最後まで読んだあとに、上まで戻らなくてよいようにする。 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-10 border-t border-line-soft pt-4">
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface"
      >
        <span aria-hidden="true">←</span>
        {label}に戻る
      </Link>
    </div>
  );
}
