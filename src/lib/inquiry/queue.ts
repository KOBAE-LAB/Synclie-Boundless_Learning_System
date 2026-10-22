// ②抽出層の処理待ち(inquiry_jobs、要件定義書14章ステップ5)。
// きっかけ(議論の終了・段階の切り替え・教科・科目のアーカイブ)で仕事を積み、そのリクエストの after() で実行する。
// 常駐のバッチやcronは作らない。失敗したもの・上限で後回しにしたものは、教師ダッシュボードの「やり直す」で再実行する。
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runJob, type JobRow } from "./pipeline";

type AdminClient = ReturnType<typeof createAdminClient>;

/** プロンプトの版。プロンプトを改良したら上げる(同じ対象でも、新しい版としてもう一度処理できる)。 */
export const PROMPT_VERSIONS = {
  extract_session: "episodes-v1",
  build_stage_story: "stage-story-v1",
  build_retrospective: "retrospective-v1",
} as const;

export type JobKind = keyof typeof PROMPT_VERSIONS;

export const MAX_ATTEMPTS = 3;
const JOB_COLUMNS = "id, kind, project_id, session_id, stage_key, prompt_version, status, attempts";

/** 同じ対象を、同じプロンプトの版で二重に処理しないための鍵。round は、後から印が付いたときの再抽出などに使う。 */
export function jobDedupeKey(job: { kind: JobKind; projectId: string; sessionId?: string | null; stageKey?: string | null; round?: string }) {
  const target = job.sessionId ?? job.projectId;
  return [job.kind, target, job.stageKey ?? "", PROMPT_VERSIONS[job.kind], job.round ?? ""].join(":");
}

export async function enqueueJob(
  admin: AdminClient,
  job: { kind: JobKind; projectId: string; sessionId?: string | null; stageKey?: string | null; round?: string },
): Promise<void> {
  const { error } = await admin.from("inquiry_jobs").insert({
    kind: job.kind,
    project_id: job.projectId,
    session_id: job.sessionId ?? null,
    stage_key: job.stageKey ?? null,
    prompt_version: PROMPT_VERSIONS[job.kind],
    dedupe_key: jobDedupeKey(job),
  });
  // 23505 = すでに同じ仕事がある(二重に積まない)。それ以外の失敗も、学習を止めないよう記録だけにする。
  if (error && error.code !== "23505") console.error("[inquiry] 処理待ちに積めませんでした", error);
}

/** レスポンスを返した後に、処理待ちを実行する。リクエストの外(テストなど)では何もしない。 */
export function scheduleJobRun(filter: { projectId?: string } = {}) {
  try {
    after(async () => {
      await runPendingJobs(createAdminClient(), filter);
    });
  } catch {
    // after() はリクエストの中でしか使えない。外から呼ばれたときは、次のきっかけかダッシュボードのやり直しで実行される。
  }
}

/** 日本時間の今月の初め(月の上限の判定用)。 */
export function monthStartJst(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 60 * 60 * 1000);
}

/** 今月の使用金額の目安が、管理者が決めた上限(環境変数 SYNCLIE_MONTHLY_AI_BUDGET_USD)を超えたか。上限が無ければ false。 */
export async function isOverMonthlyBudget(admin: AdminClient): Promise<boolean> {
  const budget = Number(process.env.SYNCLIE_MONTHLY_AI_BUDGET_USD);
  if (!Number.isFinite(budget) || budget <= 0) return false;
  const { data, error } = await admin.rpc("ai_usage_cost_since", { p_since: monthStartJst().toISOString() });
  if (error) return false;
  return Number(data ?? 0) >= budget;
}

export async function runPendingJobs(admin: AdminClient, filter: { projectId?: string; limit?: number } = {}) {
  let query = admin.from("inquiry_jobs").select(JOB_COLUMNS).eq("status", "pending");
  if (filter.projectId) query = query.eq("project_id", filter.projectId);
  const { data: jobs } = await query.order("created_at", { ascending: true }).limit(filter.limit ?? 50);

  for (const job of (jobs ?? []) as JobRow[]) {
    // 上限を超えたら、残りは後回しにする(学習者の対話そのものは止めない)。
    if (await isOverMonthlyBudget(admin)) {
      await admin.from("inquiry_jobs").update({ status: "deferred", updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "pending");
      continue;
    }
    // 取り合い防止: pending の行だけを running にできた場合に処理する。
    const { data: claimed } = await admin
      .from("inquiry_jobs")
      .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const status = await runJob(admin, job);
      await admin.from("inquiry_jobs").update({ status, error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from("inquiry_jobs")
        .update({ status: "failed", error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", job.id);
    }
  }
}

/** 失敗・後回しにした仕事を、もう一度処理待ちに戻す(教師ダッシュボードの「やり直す」)。 */
export async function retryJobs(admin: AdminClient, projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;
  const { data } = await admin
    .from("inquiry_jobs")
    .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
    .in("project_id", projectIds)
    .in("status", ["failed", "deferred"])
    .select("id");
  return (data ?? []).length;
}
