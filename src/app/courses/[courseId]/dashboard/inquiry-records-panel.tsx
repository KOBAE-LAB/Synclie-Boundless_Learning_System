// 教師ダッシュボードの「探究の記録づくり」と「AIの使用量」(要件定義書14章ステップ5)。
// 記録づくり(エピソード・段階の物語・軌跡)は、議論の終了や段階の切り替えのあとに自動で動く。ここでは、
// その様子(処理待ち・失敗・後回し)と、失敗したものの「やり直す」、この授業回の今月のAIの使用量の目安を見せる。
import type { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { monthStartJst } from "@/lib/inquiry/queue";
import { retryInquiryJobsAction } from "./actions";

type AdminClient = ReturnType<typeof createAdminClient>;

const STATUS_LABELS: Record<string, string> = {
  pending: "処理待ち",
  running: "処理中",
  done: "完了",
  skipped: "対象外",
  failed: "失敗",
  deferred: "後回し(月の上限)",
};

export async function InquiryRecordsPanel({ admin, courseId }: { admin: AdminClient; courseId: string }) {
  const { data: course } = await admin.from("courses").select("series_id").eq("id", courseId).maybeSingle();
  const { data: projects } = course
    ? await admin.from("inquiry_projects").select("id").eq("series_id", course.series_id)
    : { data: [] };
  const projectIds = (projects ?? []).map((p) => p.id as string);

  const [{ data: jobs }, { count: episodeCount }, { data: usageRows }] = await Promise.all([
    projectIds.length > 0
      ? admin.from("inquiry_jobs").select("status").in("project_id", projectIds)
      : Promise.resolve({ data: [] as { status: string }[] }),
    projectIds.length > 0
      ? admin.from("inquiry_episodes").select("id", { count: "exact", head: true }).in("project_id", projectIds)
      : Promise.resolve({ count: 0 }),
    admin.rpc("ai_usage_summary_since", { p_since: monthStartJst().toISOString(), p_course_id: courseId }),
  ]);

  const counts = new Map<string, number>();
  for (const job of jobs ?? []) counts.set(job.status as string, (counts.get(job.status as string) ?? 0) + 1);
  const retryable = (counts.get("failed") ?? 0) + (counts.get("deferred") ?? 0);
  const usage = (usageRows as { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }[] | null)?.[0];

  return (
    <section className="mt-8 rounded-lg border border-line p-4">
      <h2 className="text-sm font-medium text-ink">探究の記録づくり(自動)</h2>
      <p className="mt-1 text-xs text-ink-muted">
        議論が終わったとき・探究の段階が変わったときに、印の付いた場面から、後輩の参考になる記録(エピソード)を作ります。
        この教科・科目のエピソード: {episodeCount ?? 0}件
      </p>
      {counts.size > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {[...counts.entries()].map(([status, n]) => (
            <li key={status} className={status === "failed" ? "font-medium text-danger" : undefined}>
              {STATUS_LABELS[status] ?? status}: {n}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">まだ記録づくりは動いていません。</p>
      )}
      {retryable > 0 && (
        <form action={retryInquiryJobsAction.bind(null, courseId)} className="mt-2">
          <SubmitButton
            pendingText="実行中…"
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            失敗・後回しの{retryable}件をやり直す
          </SubmitButton>
        </form>
      )}

      <h3 className="mt-4 text-xs font-medium text-ink">この授業回のAIの使用量(今月の目安)</h3>
      {usage && usage.calls > 0 ? (
        <p className="mt-1 text-xs text-ink-muted">
          {Number(usage.calls).toLocaleString("ja-JP")}回・入力{Number(usage.input_tokens).toLocaleString("ja-JP")}トークン・出力
          {Number(usage.output_tokens).toLocaleString("ja-JP")}トークン・約 ${Number(usage.cost_usd).toFixed(2)}
          <span className="ml-1 text-ink-faint">(公開価格からの目安で、請求額そのものではありません)</span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-faint">今月の記録はまだありません。</p>
      )}
    </section>
  );
}
