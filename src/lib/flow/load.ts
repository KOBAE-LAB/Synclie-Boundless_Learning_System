import type { createAdminClient } from "@/lib/supabase/server";
import { currentStep, discussionGate, hasLaterOutput, type FlowStep, type StepKind } from "./steps";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface CourseStep extends FlowStep {
  courseId: string;
  instruction: string;
  materialId: string | null;
  videoUrl: string | null;
  minutes: number | null;
  checkQuestions: unknown;
}

export interface LearnerFlow {
  steps: CourseStep[];
  doneIds: Set<string>;
  inOrder: boolean;
}

export const STEP_COLUMNS = "id, course_id, position, kind, title, instruction, material_id, video_url, minutes, check_questions";

export function toCourseStep(row: Record<string, unknown>): CourseStep {
  return {
    id: row.id as string,
    courseId: row.course_id as string,
    position: row.position as number,
    kind: row.kind as StepKind,
    title: row.title as string,
    instruction: (row.instruction as string) ?? "",
    materialId: (row.material_id as string | null) ?? null,
    videoUrl: (row.video_url as string | null) ?? null,
    minutes: (row.minutes as number | null) ?? null,
    checkQuestions: row.check_questions,
  };
}

/** 授業のステップと、この学習者が終えたステップを読む。ステップが無い授業は steps が空。 */
export async function loadLearnerFlow(admin: AdminClient, courseId: string, studentId: string): Promise<LearnerFlow> {
  const [{ data: stepRows }, { data: course }] = await Promise.all([
    admin.from("course_steps").select(STEP_COLUMNS).eq("course_id", courseId).order("position", { ascending: true }),
    admin.from("courses").select("steps_in_order").eq("id", courseId).maybeSingle(),
  ]);
  const steps = (stepRows ?? []).map(toCourseStep);
  const doneIds = new Set<string>();
  if (steps.length > 0) {
    const { data: progress } = await admin
      .from("step_progress")
      .select("step_id")
      .eq("student_id", studentId)
      .in("step_id", steps.map((s) => s.id));
    for (const p of progress ?? []) doneIds.add(p.step_id);
  }
  return { steps, doneIds, inOrder: course?.steps_in_order !== false };
}

/**
 * 議論(擬似メンバーとの対話)に入ってよいか確かめ、いけなければ理由つきで例外にする。
 * 画面だけでなく、サーバー側のすべての発言の入口(テキスト・手書き・音声・自動継続)で呼ぶ。
 */
export async function assertDiscussionAllowed(admin: AdminClient, courseId: string, studentId: string) {
  const flow = await loadLearnerFlow(admin, courseId, studentId);
  const gate = discussionGate(flow.steps, flow.doneIds, flow.inOrder);
  if (!gate.allowed) throw new Error(gate.reason);
  return flow;
}

/** 擬似メンバーのプロンプトに添える、いまのステップの指示(アウトプットの間だけ)。 */
export function stepContextFor(flow: LearnerFlow): string | undefined {
  const current = currentStep(flow.steps, flow.doneIds);
  if (!current || current.kind !== "output") return undefined;
  const lines = [`- いまの学習ステップ(アウトプット): ${current.title}`];
  if (current.instruction) lines.push(`- このステップで学習者が取り組むこと: ${current.instruction}`);
  return lines.join("\n");
}

/** 授業の文脈に、いまのステップの指示を足す。 */
export function withStepContext(courseContext: string | undefined, stepContext: string | undefined): string | undefined {
  if (!stepContext) return courseContext;
  return courseContext ? `${courseContext}\n${stepContext}` : stepContext;
}

export { hasLaterOutput };
