"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { isEnrolled } from "@/lib/courses/enrollment";
import { loadLearnerFlow } from "@/lib/flow/load";
import { currentStep, readCheckQuestions } from "@/lib/flow/steps";

// 学習の流れ: 学習者が、いまのステップを終えて次へ進む。インプットでは、理解チェックの問いに
// 自分の言葉で答える(答えの目安と見比べる自己確認で、AIは採点しない)。
export async function completeStepAction(courseId: string, stepId: string, formData: FormData) {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  if (!(await isEnrolled(admin, courseId, user.id))) {
    throw new Error("この授業に参加していません。");
  }

  const flow = await loadLearnerFlow(admin, courseId, user.id);
  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) throw new Error("ステップが見つかりません。");
  if (flow.doneIds.has(stepId)) redirect(`/learn/${courseId}`);

  // 順番を強制する授業では、いまのステップしか終えられない(先のステップを飛ばして終えられない)。
  if (flow.inOrder && currentStep(flow.steps, flow.doneIds)?.id !== stepId) {
    throw new Error("このステップは、まだ終えられません。");
  }

  let answers: { question: string; answer: string; selfCheck: string | null }[] | null = null;
  if (step.kind === "input") {
    const questions = readCheckQuestions(step.checkQuestions);
    if (questions.length > 0) {
      answers = questions.map((q, i) => {
        const answer = String(formData.get(`answer-${i}`) ?? "").trim().slice(0, 2000);
        if (!answer) throw new Error("理解チェックのすべての問いに、自分の言葉で答えてから進みましょう。");
        const selfCheck = String(formData.get(`self-${i}`) ?? "");
        return { question: q.question, answer, selfCheck: selfCheck === "ok" || selfCheck === "more" ? selfCheck : null };
      });
    }
  }

  const { error } = await admin.from("step_progress").upsert(
    { student_id: user.id, step_id: stepId, answers, completed_at: new Date().toISOString() },
    { onConflict: "student_id,step_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`保存に失敗しました: ${error.message}`);

  revalidatePath(`/learn/${courseId}`);
  redirect(`/learn/${courseId}`);
}
