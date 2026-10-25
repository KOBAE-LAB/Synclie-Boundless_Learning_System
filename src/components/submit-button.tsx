"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/lib/i18n/client";

/**
 * AI呼び出しなど数秒かかるサーバーアクションの送信ボタン。
 * 押した瞬間に見た目が変わらないと、二重送信や「反応していない」という誤解を招くため、
 * 処理中は無効化してラベルを差し替える(useFormStatusはフォームの子孫でしか使えないため、
 * このコンポーネント自体はクライアントコンポーネントにする必要がある)。
 */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? (pendingText ?? t("common2.processing")) : children}
    </button>
  );
}
