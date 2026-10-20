"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { generateCheckQuestions } from "@/lib/ai/input-check";
import { parseVideoUrl, type StepKind } from "@/lib/flow/steps";

// 学習の流れ(インプット/アウトプットのステップ)の設計。授業の持ち主の教師だけが変更できる。

type AdminClient = ReturnType<typeof createAdminClient>;

const MAX_STEPS = 12;

async function guard(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  return admin;
}

async function getStep(admin: AdminClient, courseId: string, stepId: string) {
  const { data } = await admin
    .from("course_steps")
    .select("id, course_id, kind, instruction, material_id")
    .eq("id", stepId)
    .maybeSingle();
  if (!data || data.course_id !== courseId) throw new Error("ステップが見つかりません。");
  return data;
}

/** 資料が、この授業のものか確かめる(他の授業の資料を指せないように)。 */
async function validMaterialId(admin: AdminClient, courseId: string, raw: string): Promise<string | null> {
  if (!raw) return null;
  const { data } = await admin.from("course_materials").select("id, course_id").eq("id", raw).maybeSingle();
  if (!data || data.course_id !== courseId) throw new Error("選んだ資料が、この授業の資料ではありません。");
  return data.id;
}

function parseMinutes(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 240 ? n : null;
}

function parseKind(raw: string): StepKind {
  return raw === "output" ? "output" : "input";
}

function fields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  if (!title) throw new Error("ステップの名前を入力してください。");
  return {
    title,
    instruction: String(formData.get("instruction") ?? "").trim().slice(0, 600),
    minutes: parseMinutes(String(formData.get("minutes") ?? "")),
    rawMaterial: String(formData.get("materialId") ?? ""),
    rawVideo: String(formData.get("videoUrl") ?? ""),
  };
}

export async function addStepAction(courseId: string, formData: FormData) {
  const admin = await guard(courseId);
  const kind = parseKind(String(formData.get("kind") ?? ""));
  const f = fields(formData);

  const { data: existing } = await admin.from("course_steps").select("position").eq("course_id", courseId);
  if ((existing?.length ?? 0) >= MAX_STEPS) throw new Error(`ステップは最大${MAX_STEPS}個までです。`);
  const position = Math.max(0, ...(existing ?? []).map((s) => s.position)) + 1;

  const { error } = await admin.from("course_steps").insert({
    course_id: courseId,
    position,
    kind,
    title: f.title,
    instruction: f.instruction,
    minutes: f.minutes,
    // 資料・動画はインプットだけが持つ。
    material_id: kind === "input" ? await validMaterialId(admin, courseId, f.rawMaterial) : null,
    video_url: kind === "input" ? parseVideoUrl(f.rawVideo) : null,
  });
  if (error) throw new Error(`追加に失敗しました: ${error.message}`);
  revalidatePath(`/courses/${courseId}/flow`);
}

export async function updateStepAction(courseId: string, stepId: string, formData: FormData) {
  const admin = await guard(courseId);
  const step = await getStep(admin, courseId, stepId);
  const f = fields(formData);
  const isInput = step.kind === "input";

  const { error } = await admin
    .from("course_steps")
    .update({
      title: f.title,
      instruction: f.instruction,
      minutes: f.minutes,
      material_id: isInput ? await validMaterialId(admin, courseId, f.rawMaterial) : null,
      video_url: isInput ? parseVideoUrl(f.rawVideo) : null,
    })
    .eq("id", stepId);
  if (error) throw new Error(`更新に失敗しました: ${error.message}`);
  revalidatePath(`/courses/${courseId}/flow`);
}

async function reindex(admin: AdminClient, courseId: string) {
  const { data } = await admin.from("course_steps").select("id").eq("course_id", courseId).order("position", { ascending: true });
  await Promise.all((data ?? []).map((s, i) => admin.from("course_steps").update({ position: i + 1 }).eq("id", s.id)));
}

export async function deleteStepAction(courseId: string, stepId: string) {
  const admin = await guard(courseId);
  await getStep(admin, courseId, stepId);
  await admin.from("course_steps").delete().eq("id", stepId);
  await reindex(admin, courseId);
  revalidatePath(`/courses/${courseId}/flow`);
}

export async function moveStepAction(courseId: string, stepId: string, direction: "up" | "down") {
  const admin = await guard(courseId);
  await getStep(admin, courseId, stepId);
  await reindex(admin, courseId);
  const { data } = await admin.from("course_steps").select("id, position").eq("course_id", courseId).order("position", { ascending: true });
  const list = data ?? [];
  const i = list.findIndex((s) => s.id === stepId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  await Promise.all([
    admin.from("course_steps").update({ position: list[j].position }).eq("id", list[i].id),
    admin.from("course_steps").update({ position: list[i].position }).eq("id", list[j].id),
  ]);
  revalidatePath(`/courses/${courseId}/flow`);
}

export async function updateFlowSettingsAction(courseId: string, formData: FormData) {
  const admin = await guard(courseId);
  await admin.from("courses").update({ steps_in_order: formData.get("stepsInOrder") === "on" }).eq("id", courseId);
  revalidatePath(`/courses/${courseId}/flow`);
}

// インプットの資料(字幕・PDFなど、RAG生成済みのもの)の本文から、理解チェックの問いを下書きする。
// 教師が押したときだけ生成する(AI呼び出しを自動化しない)。学習者の答えをAIが採点することはしない。
export async function generateCheckQuestionsAction(courseId: string, stepId: string) {
  const admin = await guard(courseId);
  const step = await getStep(admin, courseId, stepId);
  if (step.kind !== "input") throw new Error("理解チェックはインプットのステップだけに付けられます。");
  if (!step.material_id) throw new Error("先に、このステップに資料を選んで保存してください(動画の場合は字幕の資料)。");

  const { data: chunks } = await admin
    .from("material_chunks")
    .select("content, chunk_index")
    .eq("material_id", step.material_id)
    .order("chunk_index", { ascending: true });
  const text = (chunks ?? []).map((c) => c.content).join("\n").slice(0, 14000);
  if (!text) throw new Error("資料のRAGがまだ生成されていません。授業ページで資料の「生成する」を押してから試してください。");

  const questions = await generateCheckQuestions({ materialText: text, stepInstruction: step.instruction, count: 3 });
  const { error } = await admin.from("course_steps").update({ check_questions: questions }).eq("id", stepId);
  if (error) throw new Error(`保存に失敗しました: ${error.message}`);
  revalidatePath(`/courses/${courseId}/flow`);
}

export async function saveCheckQuestionsAction(courseId: string, stepId: string, formData: FormData) {
  const admin = await guard(courseId);
  const step = await getStep(admin, courseId, stepId);
  if (step.kind !== "input") throw new Error("理解チェックはインプットのステップだけに付けられます。");

  const questions: { question: string; answerPoints: string; evidence: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const question = String(formData.get(`question-${i}`) ?? "").trim().slice(0, 300);
    if (!question) continue; // 問いを空にすると、その問いは消える
    questions.push({
      question,
      answerPoints: String(formData.get(`answerPoints-${i}`) ?? "").trim().slice(0, 500),
      evidence: String(formData.get(`evidence-${i}`) ?? "").trim().slice(0, 200),
    });
  }
  await admin.from("course_steps").update({ check_questions: questions.length > 0 ? questions : null }).eq("id", stepId);
  revalidatePath(`/courses/${courseId}/flow`);
}
