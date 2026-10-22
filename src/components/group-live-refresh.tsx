"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * グループの議論(時間差が基本)で、ほかのメンバーやAIの新しい発言を画面に反映する裏方のコンポーネント。
 * 画面が見えている間だけ、一定の間隔で発言の件数を確かめ(本文は取らない軽いAPI)、増えていれば画面を更新する。
 * 常時の接続(WebSocketなど)は使わない(VPSのメモリが小さく、時間差の議論では数十秒の遅れで足りるため)。
 */
export function GroupLiveRefresh({
  courseId,
  turnCount,
  ended,
  intervalMs = 15_000,
}: {
  courseId: string;
  turnCount: number;
  ended: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/learn/${courseId}/turn-count`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number; ended: boolean };
        if (data.count !== turnCount || data.ended !== ended) router.refresh();
      } catch {
        // 通信できないときは、次の機会に確かめる
      }
    };
    const timer = window.setInterval(check, intervalMs);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [courseId, turnCount, ended, intervalMs, router]);

  return null;
}
