import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requireConsent } from "@/lib/consent";
import { isEnrolledInSeries } from "@/lib/courses/enrollment";
import { lessonName, seriesLabel } from "@/lib/courses/series";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { findActiveGroup, loadActiveMemberIds } from "@/lib/learn/session-scope";
import { joinGroupAction, leaveGroupAction, setThemeAction } from "./actions";

const dateFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

// 履修している授業シリーズの、授業回(第1回、第2回…)の一覧。公開されている回だけを見せ、
// 回ごとの進み具合(まだ/学習中/議論を終えた)と、学習の流れ(インプット・アウトプット)の進みを出す。
export default async function LearnSeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ group_error?: string }>;
}) {
  const { seriesId } = await params;
  const { group_error: groupError } = await searchParams;
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);
  if (!(await isEnrolledInSeries(admin, seriesId, user.id))) {
    redirect("/learn?not_enrolled=1");
  }

  const { data: series } = await admin.from("course_series").select("id, title, subject, planned_lessons, archived_at, kind").eq("id", seriesId).maybeSingle();
  if (!series) notFound();

  // 探究シリーズ: グループで議論する。いま入っているグループと、そのメンバー・テーマ。
  const inquiry = series.kind === "inquiry";
  const group = inquiry ? await findActiveGroup(admin, seriesId, user.id) : null;
  let groupDetail: { theme: string | null; memberNames: string[]; history: { theme: string; created_at: string }[] } | null = null;
  if (group) {
    const memberIds = await loadActiveMemberIds(admin, group.id);
    const [{ data: project }, { data: members }, { data: history }] = await Promise.all([
      admin.from("inquiry_projects").select("theme").eq("id", group.id).maybeSingle(),
      memberIds.length > 0 ? admin.from("profiles").select("id, display_name").in("id", memberIds) : Promise.resolve({ data: [] }),
      admin.from("inquiry_theme_changes").select("theme, created_at").eq("project_id", group.id).order("created_at", { ascending: false }).limit(10),
    ]);
    const nameById = new Map((members ?? []).map((m) => [m.id as string, (m.display_name as string | null) || "メンバー"]));
    groupDetail = {
      theme: (project?.theme as string | null) ?? null,
      memberNames: memberIds.map((id) => (id === user.id ? "あなた" : nameById.get(id) ?? "メンバー")),
      history: (history ?? []) as { theme: string; created_at: string }[],
    };
  }

  const { data: lessons } = await admin
    .from("courses")
    .select("id, title, lesson_no, mode")
    .eq("series_id", seriesId)
    .eq("released", true)
    .order("lesson_no", { ascending: true });
  const lessonIds = (lessons ?? []).map((l) => l.id);

  const sessionByLesson = new Map<string, { ended_at: string | null }>();
  const stepTotal = new Map<string, number>();
  const stepDone = new Map<string, number>();
  if (lessonIds.length > 0) {
    const [{ data: sessions }, { data: steps }] = await Promise.all([
      // 探究シリーズはグループの共有の議論、それ以外は本人の議論(@/lib/learn/session-scope と同じ範囲)。
      (group
        ? admin.from("learning_sessions").select("course_id, ended_at, started_at").eq("project_id", group.id).is("student_id", null)
        : admin.from("learning_sessions").select("course_id, ended_at, started_at").eq("student_id", user.id)
      )
        .in("course_id", lessonIds)
        .order("started_at", { ascending: false }),
      admin.from("course_steps").select("id, course_id").in("course_id", lessonIds),
    ]);
    for (const s of sessions ?? []) if (!sessionByLesson.has(s.course_id)) sessionByLesson.set(s.course_id, s);
    const courseOfStep = new Map<string, string>();
    for (const st of steps ?? []) {
      courseOfStep.set(st.id, st.course_id);
      stepTotal.set(st.course_id, (stepTotal.get(st.course_id) ?? 0) + 1);
    }
    if (courseOfStep.size > 0) {
      const { data: progress } = await admin
        .from("step_progress")
        .select("step_id")
        .eq("student_id", user.id)
        .in("step_id", [...courseOfStep.keys()]);
      for (const p of progress ?? []) {
        const courseId = courseOfStep.get(p.step_id);
        if (courseId) stepDone.set(courseId, (stepDone.get(courseId) ?? 0) + 1);
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current={series.title} />
      <h1 className="mt-3 text-2xl font-semibold text-ink">{seriesLabel(series.title, series.planned_lessons)}</h1>
      {series.subject && <p className="mt-1 text-sm text-ink-muted">{series.subject}</p>}
      {series.archived_at && (
        <p className="mt-3 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          このシリーズは終了しています。記録は見返せますが、新しい発言や提出はできません。
        </p>
      )}

      {inquiry && (
        <section className="mt-6 rounded-lg border border-line p-5">
          <h2 className="text-sm font-medium text-ink">あなたのグループ</h2>
          {groupError && <p className="mt-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{groupError}</p>}
          {group && groupDetail ? (
            <>
              <p className="mt-2 text-base font-semibold text-ink">{group.title}</p>
              <p className="mt-1 text-sm text-ink-muted">メンバー: {groupDetail.memberNames.join("、")}</p>
              <p className="mt-1 text-xs text-ink-faint">議論はグループで1つです。メンバーの発言は、あとから開いたときに読めます(時間差で進めて大丈夫です)。</p>
              <div className="mt-4">
                <h3 className="text-xs font-medium text-ink-faint">グループの探究のテーマ</h3>
                <p className="mt-1 text-sm text-ink">{groupDetail.theme ?? "まだ決まっていません。グループで話し合って決めましょう。"}</p>
                {!series.archived_at && (
                  <form action={setThemeAction.bind(null, seriesId)} className="mt-2 flex flex-wrap gap-2">
                    <label htmlFor="group-theme" className="sr-only">テーマ</label>
                    <input
                      id="group-theme"
                      name="theme"
                      required
                      maxLength={200}
                      defaultValue={groupDetail.theme ?? ""}
                      placeholder="例: 避難所を、高齢の人にも過ごしやすくするには?"
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm"
                    />
                    <SubmitButton pendingText="保存中…" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:opacity-50">
                      {groupDetail.theme ? "テーマを更新する" : "テーマを決める"}
                    </SubmitButton>
                  </form>
                )}
                {groupDetail.history.length > 1 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-muted">テーマの変化</summary>
                    <ol className="mt-1 space-y-1 text-sm text-ink-muted">
                      {groupDetail.history.map((h, i) => (
                        <li key={i}>
                          <span className="text-xs text-ink-faint">{dateFmt.format(new Date(h.created_at))}</span> {h.theme}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              {!series.archived_at && (
                <form action={leaveGroupAction.bind(null, seriesId)} className="mt-4">
                  <button type="submit" className="text-xs text-ink-faint hover:text-danger hover:underline">このグループを抜ける(これまでの記録は残ります)</button>
                </form>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-muted">この探究は、グループで議論します。先生に割り当ててもらうか、先生から聞いたグループのコードを入力してください。</p>
              {!series.archived_at && (
                <form action={joinGroupAction.bind(null, seriesId)} className="mt-3 flex flex-wrap gap-2">
                  <label htmlFor="group-code" className="sr-only">グループのコード</label>
                  <input
                    id="group-code"
                    name="code"
                    required
                    autoComplete="off"
                    placeholder="グループのコード"
                    className="w-48 rounded-md border border-line bg-surface-raised px-3 py-1.5 font-mono text-sm uppercase tracking-widest"
                  />
                  <SubmitButton pendingText="参加中…" className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50">
                    グループに入る
                  </SubmitButton>
                </form>
              )}
            </>
          )}
        </section>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">授業回({(lessons ?? []).length}回が公開中)</h2>
      <ol className="mt-3 space-y-2">
        {(lessons ?? []).map((lesson) => {
          const session = sessionByLesson.get(lesson.id);
          const status = !session ? "まだ" : session.ended_at ? "議論を終えた" : "学習中";
          const total = stepTotal.get(lesson.id) ?? 0;
          return (
            <li key={lesson.id}>
              <Link
                href={`/learn/${lesson.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-4 py-3 text-sm hover:bg-surface"
              >
                <span className="font-medium text-ink">{lessonName(lesson.lesson_no, lesson.title)}</span>
                <span className="text-xs text-ink-muted">
                  {total > 0 && `ステップ${stepDone.get(lesson.id) ?? 0}/${total}・`}
                  {status}
                </span>
              </Link>
            </li>
          );
        })}
        {(lessons ?? []).length === 0 && (
          <li className="text-sm text-ink-muted">まだ公開されている授業回がありません。先生が公開すると、ここに表示されます。</li>
        )}
      </ol>

      <BackLink href="/learn" label="授業一覧" />
    </div>
  );
}
