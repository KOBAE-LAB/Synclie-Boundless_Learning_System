import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { updateTurnAction } from "./actions";
import { Breadcrumbs, BackLink } from "@/components/breadcrumbs";

// F15: 擬似メンバーの挙動の監査と修正。
// 「擬似メンバーの発言ログを確認し、不適切・不正確な挙動を修正する」(要件定義書4章)。
// 教師が擬似メンバーの発言を一覧で確認し、直前の学習者の発言(文脈)とあわせて見ながら、
// 内容を直接修正し、「不適切/不正確」のフラグと確認メモを残せる。

interface TurnRow {
  id: string;
  session_id: string;
  speaker_type: "student" | "persona";
  persona_id: string | null;
  content: string;
  created_at: string;
  flagged_by_teacher: boolean;
  teacher_note: string | null;
}

interface PersonaTurnWithContext extends TurnRow {
  precedingStudentContent: string | null;
}

export default async function PersonaAuditPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const { user } = await requireRole("teacher");

  const admin = createAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, title, owner_teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.owner_teacher_id !== user.id) {
    notFound();
  }

  const { data: sessions } = await admin
    .from("learning_sessions")
    .select("id")
    .eq("course_id", courseId);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  const personaTurns: PersonaTurnWithContext[] = [];
  const personaNames = new Map<string, string>();

  if (sessionIds.length > 0) {
    const { data: turnRows } = await admin
      .from("dialogue_turns")
      .select(
        "id, session_id, speaker_type, persona_id, content, created_at, flagged_by_teacher, teacher_note",
      )
      .in("session_id", sessionIds)
      .order("session_id", { ascending: true })
      .order("created_at", { ascending: true });
    const turns = (turnRows ?? []) as TurnRow[];

    // セッションごとに並んでいる前提で、擬似メンバーの発言の直前にある
    // 学習者の発言を文脈として拾う(1件前がstudentでなければ文脈なしとする)。
    let previous: TurnRow | null = null;
    for (const turn of turns) {
      if (turn.speaker_type === "persona") {
        personaTurns.push({
          ...turn,
          precedingStudentContent:
            previous && previous.session_id === turn.session_id && previous.speaker_type === "student"
              ? previous.content
              : null,
        });
      }
      previous = turn;
    }
    personaTurns.reverse(); // 新しい発言から確認できるようにする

    const personaIds = [...new Set(personaTurns.map((t) => t.persona_id).filter((id): id is string => !!id))];
    if (personaIds.length > 0) {
      const { data: personas } = await admin.from("personas").select("id, name").in("id", personaIds);
      for (const persona of personas ?? []) personaNames.set(persona.id, persona.name);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/courses" }, { label: course.title, href: `/courses/${courseId}` }]} current="発言の監査と修正" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        擬似メンバーの挙動の監査と修正(F15)
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        擬似メンバーの発言ログを確認し、不適切・不正確な内容を直接修正できる。修正した内容は、
        その後の対話でも擬似メンバー自身の履歴として使われるため、同じ誤りが続くのを防げる。
      </p>

      <ul className="mt-8 space-y-4">
        {personaTurns.map((turn) => {
          const boundUpdateAction = updateTurnAction.bind(null, courseId, turn.id);
          return (
            <li
              key={turn.id}
              className={`rounded-md border px-4 py-3 text-sm ${
                turn.flagged_by_teacher
                  ? "border-warn bg-warn-soft"
                  : "border-line"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-ink-muted">
                  {turn.persona_id ? (personaNames.get(turn.persona_id) ?? "擬似メンバー") : "擬似メンバー"}
                  (AI) ・ {new Date(turn.created_at).toLocaleString("ja-JP")}
                </span>
                {turn.flagged_by_teacher && (
                  <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                    フラグ済み
                  </span>
                )}
              </div>

              {turn.precedingStudentContent && (
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
                  学習者: {turn.precedingStudentContent}
                </p>
              )}

              <form action={boundUpdateAction} className="mt-2 space-y-2">
                <label className="block">
                  <span className="sr-only">発言の内容</span>
                  <textarea
                    name="content"
                    required
                    rows={3}
                    defaultValue={turn.content}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">確認メモ</span>
                  <textarea
                    name="teacherNote"
                    rows={2}
                    placeholder="確認メモ(任意): 何が問題だったか、何を直したか"
                    defaultValue={turn.teacher_note ?? ""}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" name="flagged" defaultChecked={turn.flagged_by_teacher} />
                  不適切・不正確な発言としてフラグを立てる
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                >
                  保存する
                </button>
              </form>
            </li>
          );
        })}
        {personaTurns.length === 0 && (
          <li className="text-sm text-ink-muted">まだ擬似メンバーの発言がありません。</li>
        )}
      </ul>

      <BackLink href={`/courses/${courseId}`} label={course.title} />
    </div>
  );
}
