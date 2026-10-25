// 教師ダッシュボードの「探究の記録づくり」と「AIの使用量」(要件定義書14章ステップ5)。
// 記録づくり(エピソード・段階の物語・軌跡)は、議論の終了や段階の切り替えのあとに自動で動く。ここでは、
// その様子(処理待ち・失敗・後回し)と、失敗したものの「やり直す」、この授業回の今月のAIの使用量の目安を見せる。
import type { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import { getT } from "@/lib/i18n/server";
import { LOCALES } from "@/lib/i18n/config";
import type { DictKey } from "@/lib/i18n/translate";
import { monthStartJst } from "@/lib/inquiry/queue";
import { retryInquiryJobsAction } from "./actions";

type AdminClient = ReturnType<typeof createAdminClient>;

const STATUS_KEYS = ["pending", "running", "done", "skipped", "failed", "deferred"];

export async function InquiryRecordsPanel({ admin, courseId }: { admin: AdminClient; courseId: string }) {
  const { t, lang } = await getT();
  const locale = LOCALES[lang];
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
      <h2 className="text-sm font-medium text-ink">{t("inquiryPanel.heading")}</h2>
      <p className="mt-1 text-xs text-ink-muted">
        {t("inquiryPanel.lead", { n: episodeCount ?? 0 })}
      </p>
      {counts.size > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          {[...counts.entries()].map(([status, n]) => (
            <li key={status} className={status === "failed" ? "font-medium text-danger" : undefined}>
              {STATUS_KEYS.includes(status) ? t(`inquiryPanel.s_${status}` as DictKey) : status}: {n}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t("inquiryPanel.notRunning")}</p>
      )}
      {retryable > 0 && (
        <form action={retryInquiryJobsAction.bind(null, courseId)} className="mt-2">
          <SubmitButton
            pendingText={t("inquiryPanel.running")}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            {t("inquiryPanel.retry", { n: retryable })}
          </SubmitButton>
        </form>
      )}

      <h3 className="mt-4 text-xs font-medium text-ink">{t("inquiryPanel.usageHeading")}</h3>
      {usage && usage.calls > 0 ? (
        <p className="mt-1 text-xs text-ink-muted">
          {t("inquiryPanel.usageLine", { c: Number(usage.calls).toLocaleString(locale), i: Number(usage.input_tokens).toLocaleString(locale), o: Number(usage.output_tokens).toLocaleString(locale), cost: Number(usage.cost_usd).toFixed(2) })}
          <span className="ml-1 text-ink-faint">{t("inquiryPanel.usageNote")}</span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-faint">{t("inquiryPanel.noUsage")}</p>
      )}
    </section>
  );
}
