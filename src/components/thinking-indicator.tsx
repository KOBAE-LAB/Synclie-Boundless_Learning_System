"use client";

import { useFormStatus } from "react-dom";
import { useT } from "@/lib/i18n/client";

/**
 * 発言送信フォームの中に置く。送信〜擬似メンバーの応答が返るまでの数秒間、
 * 「相手が今考えている」ことを示す点滅ドットを表示する(社会的存在感・臨場感のため。
 * useFormStatusを使うためクライアントコンポーネントにする必要がある)。
 */
export function ThinkingIndicator({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  if (!pending) return null;

  return (
    <p
      className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted"
      role="status"
      aria-live="polite"
    >
      {label ?? t("thinking.label")}
      <span className="flex items-center gap-0.5" aria-hidden="true">
        <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
        <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
        <span className="thinking-dot h-1 w-1 rounded-full bg-current" />
      </span>
    </p>
  );
}
