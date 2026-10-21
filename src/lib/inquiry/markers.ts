// 印(inquiry_markers、要件定義書14章ステップ5)。対話の最中に、AIを呼ばずに「この場面は大事」の目印を付ける。
// 議論の終了時の抽出で、印の付いた場面が優先される。
import type { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export type MarkerKind = "evidence_shift" | "persona_conceded" | "student_keep" | "teacher_mark";

export const MARKER_REASONS: Record<MarkerKind, string> = {
  evidence_shift: "学習者が新しい根拠や具体例を出した",
  persona_conceded: "AIの仲間が根拠を受けて考えを変えた",
  student_keep: "学習者本人が「後輩に残したい」と選んだ",
  teacher_mark: "教師が大事な場面として選んだ",
};

/** 印を付ける(同じ発言・同じ種類は1つだけ)。失敗しても対話は止めない。 */
export async function addMarker(
  admin: AdminClient,
  marker: { turnId: string; sessionId: string; kind: MarkerKind; createdBy?: string | null; note?: string | null },
): Promise<void> {
  const { error } = await admin.from("inquiry_markers").upsert(
    {
      turn_id: marker.turnId,
      session_id: marker.sessionId,
      kind: marker.kind,
      created_by: marker.createdBy ?? null,
      note: marker.note ?? null,
    },
    { onConflict: "turn_id,kind", ignoreDuplicates: true },
  );
  if (error) console.error("[inquiry] 印を付けられませんでした", error);
}

export async function removeMarker(admin: AdminClient, turnId: string, kind: MarkerKind): Promise<void> {
  await admin.from("inquiry_markers").delete().eq("turn_id", turnId).eq("kind", kind);
}

/**
 * 学習者が印を付けてよい発言か: 本人の、その授業回の議論の発言だけ(他人の議論には付けられない)。
 * 付けてよければ、その議論(セッション)を返す。権限の境界なので、テストで固定している(markers.test.ts)。
 */
export async function loadOwnTurnSession(
  admin: AdminClient,
  params: { turnId: string; studentId: string; courseId: string },
): Promise<{ id: string; ended_at: string | null; project_id: string | null } | null> {
  const { data: turn } = await admin.from("dialogue_turns").select("id, session_id").eq("id", params.turnId).maybeSingle();
  if (!turn) return null;
  const { data: session } = await admin
    .from("learning_sessions")
    .select("id, student_id, course_id, ended_at, project_id")
    .eq("id", turn.session_id)
    .maybeSingle();
  if (!session || session.student_id !== params.studentId || session.course_id !== params.courseId) return null;
  return { id: session.id, ended_at: session.ended_at, project_id: session.project_id };
}
