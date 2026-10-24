// anonymize_episodes: 他の学校に出す先輩のAIのために、エピソードの「他校向けの版」(narrated_cross_org)を作る(0049)。
//  - 材料の学習者が全員、他の学校で使うことへの別の同意(share_wide)をしているときだけ作る(していなければ skipped)。
//  - すでに他校向けの版があるエピソードは作り直さない(何度動かしても増えない)。
//  - AIは1回に最大 BATCH 場面。名簿の名前は、AIの後にもう一度、機械的に伏せる。検索用の埋め込みは他校向けの語りから作る。
import type { createAdminClient } from "@/lib/supabase/server";
import { openai, MODEL_EMBEDDING, MODEL_JUDGE } from "@/lib/ai/openai";
import { withAiContext } from "@/lib/ai/usage";
import { anonymizeEpisodes } from "@/lib/ai/episode-anonymize";
import { maskNames } from "./anonymize";
import { isEligibleLearner } from "./eligibility";
import { hasWideConsent, projectLearnerIds } from "./wide-consent";

type AdminClient = ReturnType<typeof createAdminClient>;

export const ANONYMIZE_BATCH = 8;

async function embed(text: string): Promise<number[]> {
  const response = await withAiContext({ purpose: "episode_embedding" }, () => openai.embeddings.create({ model: MODEL_EMBEDDING, input: text }));
  return response.data[0].embedding;
}

/** 材料の学習者が全員、別の同意をしているか(1人以上いること)。 */
export async function everyoneConsentedWide(admin: AdminClient, projectId: string): Promise<{ ok: boolean; learnerIds: string[] }> {
  const learnerIds = await projectLearnerIds(admin, [projectId]);
  const eligible: string[] = [];
  for (const id of learnerIds) if (await isEligibleLearner(admin, id)) eligible.push(id);
  if (eligible.length === 0) return { ok: false, learnerIds };
  for (const id of eligible) if (!(await hasWideConsent(admin, id))) return { ok: false, learnerIds };
  return { ok: true, learnerIds };
}

export async function runAnonymizeEpisodes(
  admin: AdminClient,
  job: { project_id: string; prompt_version: string },
): Promise<"done" | "skipped"> {
  const { ok, learnerIds } = await everyoneConsentedWide(admin, job.project_id);
  if (!ok) return "skipped";

  const { data: episodes } = await admin.from("inquiry_episodes").select("id").eq("project_id", job.project_id).order("seq", { ascending: true });
  const episodeIds = (episodes ?? []).map((e) => e.id as string);
  if (episodeIds.length === 0) return "done";
  const { data: versions } = await admin
    .from("inquiry_episode_versions")
    .select("episode_id, kind, body, context_header, version")
    .in("episode_id", episodeIds)
    .in("kind", ["narrated", "narrated_cross_org"])
    .order("version", { ascending: true });
  const done = new Set((versions ?? []).filter((v) => v.kind === "narrated_cross_org").map((v) => v.episode_id as string));
  const latest = new Map<string, { header: string; body: string }>();
  for (const v of versions ?? []) {
    if (v.kind === "narrated") latest.set(v.episode_id as string, { header: (v.context_header as string | null) ?? "", body: v.body as string });
  }
  const todo = episodeIds.filter((id) => latest.has(id) && !done.has(id)).map((id) => ({ id, ...latest.get(id)! }));
  if (todo.length === 0) return "done";

  const { data: project } = await admin.from("inquiry_projects").select("owner_teacher_id").eq("id", job.project_id).maybeSingle();
  const names = await namesToMask(admin, learnerIds, (project?.owner_teacher_id as string | null) ?? null);

  for (let i = 0; i < todo.length; i += ANONYMIZE_BATCH) {
    const rewritten = await anonymizeEpisodes(todo.slice(i, i + ANONYMIZE_BATCH));
    for (const r of rewritten) {
      const header = maskNames(r.header, names);
      const body = maskNames(r.body, names);
      const embedding = await embed(`${header}\n${body}`);
      const { error } = await admin.from("inquiry_episode_versions").insert({
        episode_id: r.id,
        kind: "narrated_cross_org",
        version: 1,
        body,
        context_header: header,
        embedding,
        model: MODEL_JUDGE,
        prompt_version: job.prompt_version,
      });
      if (error && error.code !== "23505") throw new Error(`他校向けの版の保存に失敗しました: ${error.message}`);
    }
  }
  return "done";
}

/** 伏せる名前: 学習者本人・担当教師の表示名と、その組織名。 */
async function namesToMask(admin: AdminClient, studentIds: string[], teacherId: string | null): Promise<string[]> {
  const ids = [...studentIds, teacherId].filter((id): id is string => !!id);
  const { data: profiles } = await admin.from("profiles").select("display_name, organization_id").in("id", ids);
  const orgIds = [...new Set((profiles ?? []).map((p) => p.organization_id).filter((id): id is string => !!id))];
  const { data: orgs } = orgIds.length > 0 ? await admin.from("organizations").select("name").in("id", orgIds) : { data: [] };
  return [...(profiles ?? []).map((p) => p.display_name as string | null), ...(orgs ?? []).map((o) => o.name as string)].filter(
    (n): n is string => !!n,
  );
}

/** この探究プロジェクトを材料にした先輩のAIで、広い範囲に公開されているものがあるか(新しいエピソードにも他校向けの版が要るか)。 */
export async function projectHasWideScope(admin: AdminClient, projectId: string): Promise<boolean> {
  const { data } = await admin.from("personas").select("id").eq("source_project_id", projectId).in("share_scope", ["municipality", "network"]).limit(1);
  return (data ?? []).length > 0;
}
