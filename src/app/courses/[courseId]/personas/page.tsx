import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import {
  createPersonaAction,
  deletePersonaAction,
  approvePersonaAction,
  activatePersonaAction,
  deactivatePersonaAction,
  generateEvolvedPersonasAction,
  recommendPersonaDraftsAction,
  recommendPersonaAvatarAction,
  setPersonaAvatarAction,
  sharePersonaAction,
  unsharePersonaAction,
  type PersonaStatus,
} from "./actions";
import { PersonaForm } from "./persona-form";
import { assignPersonaTones, toneClass, personaInitial } from "@/lib/persona-tones";
import { loadLessonCrumbs, loadSiblingLessons } from "@/lib/courses/series";
import { LessonCopyForm } from "@/components/lesson-copy-form";
import { copyPersonasFromLessonAction } from "../lesson-copy-actions";
import type { DictKey } from "@/lib/i18n/translate";
import { SeniorLoansSection } from "./senior-loans-section";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

type AvatarStatus = "pending" | "done" | "failed";

interface PersonaRow {
  id: string;
  created_at?: string;
  name: string;
  tier: string;
  status: PersonaStatus;
  profile: { role?: string } | null;
  origin_note: string | null;
  shared_at: string | null;
  avatar_id: string | null;
  avatar_status: AvatarStatus;
  avatar_error: string | null;
}

interface AvatarOptionRow {
  id: string;
  file_path: string;
  label: string;
}

interface CorpusEntryRow {
  id: string;
  topic: string;
  misconception: string | null;
  effective_question: string | null;
}

const STATUS_STYLES: Record<PersonaStatus, string> = {
  draft: "bg-surface text-ink-muted",
  approved: "bg-warn-soft text-warn",
  active: "bg-success-soft text-success",
};

export default async function PersonasPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ copied?: string; skipped?: string; senior_error?: string }>;
}) {
  const { courseId } = await params;
  const { copied: copiedParam, skipped: skippedParam, senior_error: seniorError } = await searchParams;
  const { user } = await requireRole("teacher");
  const { t, lang } = await getT();

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id, objective, learner_level, discussion_style, ai_member_count")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { data: personas } = await admin
    .from("personas")
    .select("id, name, tier, status, profile, origin_note, shared_at, avatar_id, avatar_status, avatar_error, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  const { data: corpusEntries } = await admin
    .from("learner_corpus_entries")
    .select("id, topic, misconception, effective_question")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });

  // F25: アバター候補プール(全授業共通)。ラベルの五十音順で選択肢を並べる。
  const { data: avatarOptions } = await admin
    .from("avatar_options")
    .select("id, file_path, label")
    .order("label", { ascending: true });
  const avatarOptionRows = (avatarOptions ?? []) as AvatarOptionRow[];
  const avatarById = new Map(avatarOptionRows.map((a) => [a.id, a]));

  const rows = (personas ?? []) as PersonaRow[];
  const activeCount = rows.filter((p) => p.status === "active").length;
  // ペルソナごとの色(学習者の画面の吹き出し・映像タイルと同じ。作成順で割り当てる)
  const personaTones = assignPersonaTones(
    [...rows].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")).map((p) => p.id),
  );
  const siblingLessons = await loadSiblingLessons(admin, courseId);
  const boundCreateAction = createPersonaAction.bind(null, courseId);
  const boundGenerateEvolvedAction = generateEvolvedPersonasAction.bind(null, courseId);
  const boundRecommendDraftsAction = recommendPersonaDraftsAction.bind(null, courseId);
  const targetCount = course.ai_member_count as number | null;
  // 目標人数に対して、あと何人分の案を作ればよいか(使用中・承認済み・下書きをすべて数える)
  const remainingToTarget = targetCount ? Math.max(targetCount - rows.length, 0) : null;
  const defaultRecommendCount = Math.min(Math.max(remainingToTarget ?? 2, 1), 5);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId, lang))?.teacherTrail ?? [])]} current={t("personasPage.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("personasPage.title")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("personasPage.lead")}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {t("personasPage.activeLabel")}<span className="font-medium">{activeCount}</span>
      </p>

      {targetCount !== null && (
        <p
          className={`mt-1 text-sm ${activeCount === targetCount ? "text-ink-muted" : "text-warn"}`}
        >
          {t("personasPage.targetLine", { n: targetCount })}
          {activeCount === targetCount
            ? t("personasPage.targetMatch")
            : activeCount < targetCount
              ? t("personasPage.targetShort", { n: targetCount - activeCount })
              : t("personasPage.targetOver", { n: activeCount - targetCount })}
        </p>
      )}

      <LessonCopyForm
        lessons={siblingLessons}
        action={copyPersonasFromLessonAction.bind(null, courseId)}
        title={t("personasPage.copyTitle")}
        description={t("personasPage.copyDesc")}
        copied={copiedParam}
        skipped={skippedParam}
      />

      <div className="mt-8 rounded-lg border border-line p-5">
        <h2 className="text-sm font-medium text-ink">{t("personasPage.aiTitle")}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {t("personasPage.aiLeadA")}<strong>{t("personasPage.aiLeadStrong")}</strong>{t("personasPage.aiLeadB")}
        </p>
        {!course.objective && (
          <p className="mt-2 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
            {t("personasPage.noObjective")}
            <Link href={`/courses/${courseId}`} className="ml-1 underline">
              {t("personasPage.toSettings")}
            </Link>
          </p>
        )}
        <form action={boundRecommendDraftsAction} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="recommend-count" className="text-xs font-medium text-ink-muted">
                {t("personasPage.countLabel")}
              </label>
              <select
                id="recommend-count"
                name="count"
                defaultValue={defaultRecommendCount}
                className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t("personasPage.nPeople", { n })}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label htmlFor="recommend-hint" className="text-xs font-medium text-ink-muted">
                {t("personasPage.hint")}
              </label>
              <input
                id="recommend-hint"
                name="hint"
                maxLength={200}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <SubmitButton
            pendingText={t("personasPage.makingDrafts")}
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {t("personasPage.makeDrafts")}
          </SubmitButton>
          <p className="text-xs text-ink-faint">
            {t("personasPage.aiNote")}
          </p>
        </form>
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink">
        {t("personasPage.listHeading", { n: rows.length })}
      </h2>
      <ul className="mt-3 space-y-2">
        {rows.map((persona) => {
          const boundDeleteAction = deletePersonaAction.bind(null, courseId, persona.id);
          const boundApproveAction = approvePersonaAction.bind(null, courseId, persona.id);
          const boundActivateAction = activatePersonaAction.bind(null, courseId, persona.id);
          const boundDeactivateAction = deactivatePersonaAction.bind(null, courseId, persona.id);
          const boundShareAction = sharePersonaAction.bind(null, courseId, persona.id);
          const boundUnshareAction = unsharePersonaAction.bind(null, courseId, persona.id);
          const boundRecommendAvatarAction = recommendPersonaAvatarAction.bind(
            null,
            courseId,
            persona.id,
          );
          const boundSetAvatarAction = setPersonaAvatarAction.bind(null, courseId, persona.id);
          const avatar = persona.avatar_id ? avatarById.get(persona.avatar_id) : undefined;

          return (
            <li
              key={persona.id}
              className={`rounded-md border border-l-4 border-line bg-surface px-4 py-3 text-sm ${toneClass(personaTones[persona.id])}`}
              style={{ borderLeftColor: "var(--tone)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/courses/${courseId}/personas/${persona.id}`}
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  {avatar ? (
                    <img
                      src={avatar.file_path}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="persona-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    >
                      {personaInitial(persona.name)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{persona.name}</span>
                    {persona.profile?.role && (
                      <span className="ml-2 text-ink-muted">({persona.profile.role})</span>
                    )}
                    <span className="ml-2 text-xs text-ink-faint">
                      [{["teacher_defined", "rag_initial", "evolved", "senior", "aggregate"].includes(persona.tier) ? t(`personaEnums.tier_${persona.tier}` as DictKey) : persona.tier}]
                    </span>
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-2">
                  <ol className="flex items-center gap-1 text-xs" aria-label={t("personasPage.statusAria", { s: t(`personaEnums.status_${persona.status}`) })}>
                    {(["draft", "approved", "active"] as const).map((st, idx) => {
                      const order = { draft: 0, approved: 1, active: 2 } as const;
                      const reached = order[persona.status] >= idx;
                      const isNow = persona.status === st;
                      return (
                        <li
                          key={st}
                          aria-current={isNow ? "step" : undefined}
                          className={`rounded-full px-2 py-0.5 ${
                            isNow ? STATUS_STYLES[st] + " font-semibold" : reached ? "bg-surface text-ink-muted" : "text-ink-faint"
                          }`}
                        >
                          {idx + 1} {t(`personaEnums.status_${st}`)}
                        </li>
                      );
                    })}
                  </ol>

                  {persona.status === "draft" && (
                    <form action={boundApproveAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        {t("personasPage.nextApprove")}
                      </button>
                    </form>
                  )}
                  {persona.status === "approved" && (
                    <form action={boundActivateAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        {t("personasPage.nextUse")}
                      </button>
                    </form>
                  )}
                  {persona.status === "active" && (
                    <form action={boundDeactivateAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                      >
                        {t("personasPage.stopUse")}
                      </button>
                    </form>
                  )}

                  <form action={boundDeleteAction}>
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                    >
                      {t("personasPage.delete")}
                    </button>
                  </form>
                </div>
              </div>
              {persona.origin_note && (
                <p className="mt-2 text-xs text-ink-faint">{t("personasPage.origin", { note: persona.origin_note })}</p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {persona.shared_at ? (
                  <>
                    <span className="text-xs text-accent">{t("personasPage.sharedNow")}</span>
                    <form action={boundUnshareAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                      >
                        {t("personasPage.unshare")}
                      </button>
                    </form>
                  </>
                ) : (
                  persona.status !== "draft" && (
                    <form action={boundShareAction}>
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                      >
                        {t("personasPage.share")}
                      </button>
                    </form>
                  )
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line-soft pt-2">
                <span className="text-xs text-ink-faint">
                  {t("personasPage.avatarLine", { s: t(`personaEnums.avatar_${persona.avatar_status}`) })}
                  {avatar && ` — ${avatar.label}`}
                </span>
                <form action={boundRecommendAvatarAction}>
                  <SubmitButton
                    pendingText={t("personasPage.recommending")}
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface disabled:opacity-50"
                  >
                    {persona.avatar_id ? t("personasPage.reRecommend") : t("personasPage.recommend")}
                  </SubmitButton>
                </form>
                <form action={boundSetAvatarAction} className="flex items-center gap-1">
                  <label className="sr-only" htmlFor={`avatar-select-${persona.id}`}>
                    {t("personasPage.pickManual")}
                  </label>
                  <select
                    id={`avatar-select-${persona.id}`}
                    name="avatarId"
                    defaultValue={persona.avatar_id ?? ""}
                    className="rounded-md border border-line px-2 py-0.5 text-xs bg-surface-raised"
                  >
                    <option value="" disabled>
                      {t("personasPage.manual")}
                    </option>
                    {avatarOptionRows.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface"
                  >
                    {t("personasPage.change")}
                  </button>
                </form>
              </div>
              {persona.avatar_status === "failed" && persona.avatar_error && (
                <p className="mt-1 text-xs text-danger">{persona.avatar_error}</p>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-sm text-ink-muted">{t("personasPage.none")}</li>
        )}
      </ul>

      <SeniorLoansSection admin={admin} courseId={courseId} teacherId={user.id} error={seniorError} />

      <details className="mt-6 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {t("personasPage.manualSummary")}
        </summary>
        <div className="mt-4">
          <PersonaForm action={boundCreateAction} submitLabel={t("personasPage.create")} />
        </div>
      </details>

      <details className="mt-3 rounded-lg border border-line p-5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {t("personasPage.evolvedSummary")}
        </summary>
        <p className="mt-1 text-sm text-ink-muted">
          {t("personasPage.evolvedLead")}
        </p>
        <form action={boundGenerateEvolvedAction} className="mt-3">
          <SubmitButton
            pendingText={t("personasPage.generating")}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50"
          >
            {t("personasPage.generateEvolved")}
          </SubmitButton>
        </form>

        {corpusEntries && corpusEntries.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-ink-muted">
              {t("personasPage.extracted", { n: corpusEntries.length })}
            </summary>
            <ul className="mt-2 space-y-2 text-xs text-ink-muted">
              {(corpusEntries as CorpusEntryRow[]).map((entry) => (
                <li key={entry.id} className="rounded-md border border-line p-2">
                  <p>{t("personasPage.topic", { t: entry.topic })}</p>
                  {entry.misconception && <p>{t("personasPage.misconception", { t: entry.misconception })}</p>}
                  {entry.effective_question && <p>{t("personasPage.effectiveQuestion", { t: entry.effective_question })}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>



      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
