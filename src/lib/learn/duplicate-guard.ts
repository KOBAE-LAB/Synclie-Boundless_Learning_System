// 二重送信の防御(サーバー側)。ボタンの二重押し・画面の反応が遅くて押し直した・通信の再送などで、同じ内容の成果が
// 1〜2秒の間に2件できる不具合があった(2026-10-23)。画面のボタンを無効にするだけでは、再送などを防げないので、
// サーバーでも「同じ学習者が、同じ授業回に、同じ内容を、ごく短い間に提出した」ものは、2件目を作らない。
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

/** この間に同じ内容の提出があれば、二重送信とみなす。 */
export const DUPLICATE_SUBMISSION_WINDOW_MS = 60_000;

/** 直近の提出の中に、同じ内容(前後の空白を除く)で、間もないものがあるか(純粋関数)。 */
export function isRecentDuplicate(
  recent: { content: string | null; created_at: string | null }[],
  content: string,
  nowMs: number,
  windowMs: number = DUPLICATE_SUBMISSION_WINDOW_MS,
): boolean {
  const target = content.trim();
  return recent.some((r) => {
    if ((r.content ?? "").trim() !== target || !r.created_at) return false;
    const at = new Date(r.created_at).getTime();
    return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < windowMs;
  });
}

/** 学習者が、この授業回で、同じ内容をついさっき提出していないか。 */
export async function hasRecentIdenticalSubmission(
  admin: AdminClient,
  input: { studentId: string; courseId: string; content: string; nowMs?: number },
): Promise<boolean> {
  const { data } = await admin
    .from("submissions")
    .select("content, created_at")
    .eq("student_id", input.studentId)
    .eq("course_id", input.courseId)
    .order("created_at", { ascending: false })
    .limit(3);
  return isRecentDuplicate((data ?? []) as { content: string | null; created_at: string | null }[], input.content, input.nowMs ?? Date.now());
}

// 「確認してから保存する」だけでは、ほぼ同時に届いた2つのリクエストが、どちらも確認を通り抜けてしまう。
// そこで、処理中の同じ提出(学習者+授業回+内容)は、同時に1つだけ走らせる(サーバーは1つのプロセスで動いているため、
// プロセスの中の記憶で足りる)。処理が終われば外し、その後の2件目は上の「直近の同じ内容」の確認が止める。
const inFlight = new Set<string>();

/** 同じ提出が処理中でなければ、処理中の印を付けて「外す関数」を返す。すでに処理中なら null(二重送信)。 */
export function tryAcquireSubmissionLock(studentId: string, courseId: string, content: string): (() => void) | null {
  const key = `${studentId}:${courseId}:${content.trim()}`;
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  return () => {
    inFlight.delete(key);
  };
}
