"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";
import { generateEvolvedRoles } from "@/lib/ai/evolved-persona";
import { recommendPersonaAvatar, type AvatarOption } from "@/lib/ai/persona-avatar";
import { recommendPersonaDrafts, MAX_RECOMMEND_COUNT } from "@/lib/ai/persona-recommend";
import { normalizeReplyTempo, normalizeThinkingDepth } from "@/lib/persona-traits";

type AdminClient = ReturnType<typeof createAdminClient>;

// F03: ペルソナ設定。段階1では教師設定型(tier='teacher_defined')のみを扱う。
// RAG初期型・学習進化型(資料や学習者データからの自動生成)は段階2のF10で扱う。
export interface PersonaProfileFields {
  role: string;
  developmentalStage: string;
  existingKnowledge: string;
  tone: string;
}

export interface PersonaStanceFields {
  position: string;
  goal: string;
}

export interface PersonaBehaviorRuleFields {
  speakingFrequency: string;
  teachingDegree: string;
  interventionCondition: string;
  // 考え方の深さ・返答のテンポ(src/lib/persona-traits.ts)。未設定の既存ペルソナは標準・ふつう扱い
  thinkingDepth?: string;
  replyTempo?: string;
}

export type PersonaStatus = "draft" | "approved" | "active";

async function getOwnedPersona(
  admin: ReturnType<typeof createAdminClient>,
  courseId: string,
  personaId: string,
) {
  const { data: persona } = await admin
    .from("personas")
    .select("id, course_id, status")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona || persona.course_id !== courseId) {
    throw new Error("ペルソナが見つかりません。");
  }
  return persona as { id: string; course_id: string; status: PersonaStatus };
}

function readPersonaFormData(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    throw new Error("ペルソナの名前を入力してください。");
  }

  const profile: PersonaProfileFields = {
    role: String(formData.get("role") ?? "").trim(),
    developmentalStage: String(formData.get("developmentalStage") ?? "").trim(),
    existingKnowledge: String(formData.get("existingKnowledge") ?? "").trim(),
    tone: String(formData.get("tone") ?? "").trim(),
  };

  const stance: PersonaStanceFields = {
    position: String(formData.get("stancePosition") ?? "").trim(),
    goal: String(formData.get("stanceGoal") ?? "").trim(),
  };

  const behaviorRules: PersonaBehaviorRuleFields = {
    speakingFrequency: String(formData.get("speakingFrequency") ?? "普通").trim(),
    teachingDegree: String(formData.get("teachingDegree") ?? "問い返すのみ").trim(),
    interventionCondition: String(formData.get("interventionCondition") ?? "").trim(),
    thinkingDepth: normalizeThinkingDepth(formData.get("thinkingDepth")),
    replyTempo: normalizeReplyTempo(formData.get("replyTempo")),
  };

  return { name, profile, stance, behaviorRules };
}

export async function createPersonaAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { name, profile, stance, behaviorRules } = readPersonaFormData(formData);

  const { error } = await admin.from("personas").insert({
    course_id: courseId,
    name,
    tier: "teacher_defined",
    profile,
    stance,
    behavior_rules: behaviorRules,
  });

  if (error) {
    throw new Error(`ペルソナの作成に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

export async function updatePersonaAction(
  courseId: string,
  personaId: string,
  formData: FormData,
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  await getOwnedPersona(admin, courseId, personaId);

  const { name, profile, stance, behaviorRules } = readPersonaFormData(formData);

  const { error } = await admin
    .from("personas")
    .update({
      name,
      profile,
      stance,
      behavior_rules: behaviorRules,
      updated_at: new Date().toISOString(),
    })
    .eq("id", personaId);

  if (error) {
    throw new Error(`ペルソナの更新に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
  redirect(`/courses/${courseId}/personas`);
}

// F21: ペルソナを組織の共有ライブラリに公開する。同じ組織の教師は自動的に複製できる
// (承認不要)。他組織の教師は/libraryから共有リクエスト→組織の承認者の判断を経て複製する。
// 下書きの品質を担保するため、承認済み以上のペルソナだけを共有できるようにする。
export async function sharePersonaAction(courseId: string, personaId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  const persona = await getOwnedPersona(admin, courseId, personaId);
  if (persona.status === "draft") {
    throw new Error("下書きのペルソナは共有できません。承認してから共有してください。");
  }

  const { error } = await admin
    .from("personas")
    .update({ shared_at: new Date().toISOString() })
    .eq("id", personaId);
  if (error) {
    throw new Error(`共有に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

export async function unsharePersonaAction(courseId: string, personaId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  await getOwnedPersona(admin, courseId, personaId);

  const { error } = await admin.from("personas").update({ shared_at: null }).eq("id", personaId);
  if (error) {
    throw new Error(`共有の取り消しに失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

export async function deletePersonaAction(courseId: string, personaId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  await getOwnedPersona(admin, courseId, personaId);

  const { error } = await admin.from("personas").delete().eq("id", personaId);
  if (error) {
    throw new Error(`ペルソナの削除に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

// F04: 承認ワークフロー。draft → approved → active の順にのみ進める
// (下書きのまま授業で使われることを防ぐ)。逆方向(使用中→承認済み)は
// 「このペルソナを今回は使わない」という運用のために許可する。
async function setPersonaStatus(
  courseId: string,
  personaId: string,
  from: PersonaStatus,
  to: PersonaStatus,
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const persona = await getOwnedPersona(admin, courseId, personaId);
  if (persona.status !== from) {
    throw new Error(
      `このペルソナは現在「${persona.status}」の状態のため、この操作はできません。`,
    );
  }

  const { error } = await admin
    .from("personas")
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", personaId);
  if (error) {
    throw new Error(`状態の更新に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

export async function approvePersonaAction(courseId: string, personaId: string) {
  await setPersonaStatus(courseId, personaId, "draft", "approved");
}

export async function activatePersonaAction(courseId: string, personaId: string) {
  await setPersonaStatus(courseId, personaId, "approved", "active");
}

export async function deactivatePersonaAction(courseId: string, personaId: string) {
  await setPersonaStatus(courseId, personaId, "active", "approved");
}

// F25: ペルソナのアバター推薦。プロフィール・立場の設定に応じて、あらかじめ用意した
// 画像候補プール(avatar_options)からAIに1つ選ばせる(都度の画像生成はしない)。
// 教師はこの推薦結果を、下の手動選択でいつでも変更できる(AIが一方的に見た目を固定しない)。
export async function recommendPersonaAvatarAction(courseId: string, personaId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { data: persona } = await admin
    .from("personas")
    .select("id, course_id, name, profile, stance")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona || persona.course_id !== courseId) {
    throw new Error("ペルソナが見つかりません。");
  }

  const { data: avatarOptionRows } = await admin.from("avatar_options").select("id, label, tags");
  const options = (avatarOptionRows ?? []) as AvatarOption[];

  try {
    const profile = (persona.profile ?? {}) as Partial<PersonaProfileFields>;
    const stance = (persona.stance ?? {}) as Partial<PersonaStanceFields>;
    const { avatarId } = await recommendPersonaAvatar(
      {
        name: persona.name,
        role: profile.role ?? "",
        developmentalStage: profile.developmentalStage ?? "",
        tone: profile.tone ?? "",
        stancePosition: stance.position ?? "",
        stanceGoal: stance.goal ?? "",
      },
      options,
    );
    const { error } = await admin
      .from("personas")
      .update({ avatar_id: avatarId, avatar_status: "done", avatar_error: null })
      .eq("id", personaId);
    if (error) throw new Error(error.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
    await admin
      .from("personas")
      .update({ avatar_status: "failed", avatar_error: message })
      .eq("id", personaId);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

// F25: 教師による手動でのアバター変更。AIの推薦を採用しない場合や、後から変更したい場合に使う。
export async function setPersonaAvatarAction(
  courseId: string,
  personaId: string,
  formData: FormData,
) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);
  await getOwnedPersona(admin, courseId, personaId);

  const avatarId = String(formData.get("avatarId") ?? "").trim();
  if (!avatarId) {
    throw new Error("アバターを選択してください。");
  }

  const { error } = await admin
    .from("personas")
    .update({ avatar_id: avatarId, avatar_status: "done", avatar_error: null })
    .eq("id", personaId);
  if (error) {
    throw new Error(`アバターの設定に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

// F10: 学習進化型擬似メンバー。
// 「人数が少ない間は投射を控える」(要件定義書5章)ための下限。特定の学習者の発言だと
// 推測されにくくするため、これ未満の人数では生成を拒否する。
const MIN_STUDENTS_FOR_EVOLVED = 3;

// 同意済み(consent_records.withdrawn_at is null)の学習者の発言・成果・振り返りだけを
// 集める(要件定義書6章「学習者由来コーパスへの取り込みは、同意を得たデータに限り…行う」)。
// 学習者名・IDは本文に含めない(内容だけを渡すことで個人を特定できないようにする)。
async function buildCourseActivityLog(
  admin: AdminClient,
  courseId: string,
): Promise<{ log: string; studentCount: number }> {
  const { data: consented } = await admin
    .from("consent_records")
    .select("student_id")
    .is("withdrawn_at", null);
  const consentedIds = new Set((consented ?? []).map((c) => c.student_id));
  // 管理者の動作確認用のテスト学習者(「学習者として表示」)のデータは、実際の学習者由来の
  // コーパスに混ぜない。
  const { data: testStudents } = await admin.from("profiles").select("id").not("test_owner_id", "is", null);
  for (const t of testStudents ?? []) consentedIds.delete(t.id);

  const studentIds = new Set<string>();
  const lines: string[] = [];

  // 発言は、発言した学習者(author_student_id)ごとに同意を確かめる。探究のグループの議論(0044)では、
  // 同じ議論に同意していないメンバーがいても、その人の発言だけを除く。
  const { data: sessions } = await admin
    .from("learning_sessions")
    .select("id, student_id")
    .eq("course_id", courseId);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);

  if (sessionIds.length > 0) {
    const { data: turns } = await admin
      .from("dialogue_turns")
      .select("session_id, content, author_student_id")
      .in("session_id", sessionIds)
      .eq("speaker_type", "student");
    for (const turn of turns ?? []) {
      const author = turn.author_student_id as string | null;
      if (!author || !consentedIds.has(author)) continue;
      studentIds.add(author);
      lines.push(`発言: ${turn.content}`);
    }
  }

  const { data: submissions } = await admin
    .from("submissions")
    .select("id, student_id, content")
    .eq("course_id", courseId);
  const eligibleSubmissions = (submissions ?? []).filter((s) => consentedIds.has(s.student_id));
  for (const submission of eligibleSubmissions) studentIds.add(submission.student_id);

  const submissionIds = eligibleSubmissions.map((s) => s.id);
  const reflectionBySubmission = new Map<
    string,
    { what_learned: string; what_confused: string }
  >();
  if (submissionIds.length > 0) {
    const { data: reflections } = await admin
      .from("reflections")
      .select("submission_id, what_learned, what_confused")
      .in("submission_id", submissionIds);
    for (const reflection of reflections ?? []) {
      reflectionBySubmission.set(reflection.submission_id, reflection);
    }
  }

  for (const submission of eligibleSubmissions) {
    lines.push(`成果: ${submission.content}`);
    const reflection = reflectionBySubmission.get(submission.id);
    if (reflection) {
      lines.push(`振り返り(学んだこと): ${reflection.what_learned}`);
      lines.push(`振り返り(迷ったこと): ${reflection.what_confused}`);
    }
  }

  return { log: lines.join("\n"), studentCount: studentIds.size };
}

// AIによるペルソナ案の推薦。授業設定(ねらい・校種学年・討論の型)と登録済みの資料の抜粋から、
// 互いに補い合う案をまとめて作り、**下書き(status='draft')**として保存する。教師が確認・修正して
// 承認・有効化する既存のF04の流れに乗せる(AIが一方的に使い始めることはしない)。
// 「人数分をまとめて」も「1体ずつ追加(ヒント付き)」も、同じ処理で、人数とヒントが違うだけ。
const MAX_PERSONAS_PER_COURSE = 10; // 呼び出しのたびに増え続けないための上限

export async function recommendPersonaDraftsAction(courseId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const requested = Number.parseInt(String(formData.get("count") ?? "1"), 10);
  const count = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_RECOMMEND_COUNT) : 1;
  const hint = String(formData.get("hint") ?? "").trim().slice(0, 200);

  const [{ data: course }, { data: existingRows }, { data: chunkRows }] = await Promise.all([
    admin
      .from("courses")
      .select("title, subject, mode, objective, learner_level, discussion_style")
      .eq("id", courseId)
      .maybeSingle(),
    admin.from("personas").select("name, profile, stance").eq("course_id", courseId),
    admin
      .from("material_chunks")
      .select("content")
      .eq("course_id", courseId)
      .order("material_id", { ascending: true })
      .order("chunk_index", { ascending: true })
      .limit(12),
  ]);
  if (!course) throw new Error("授業が見つかりません。");

  const existing = existingRows ?? [];
  if (existing.length + count > MAX_PERSONAS_PER_COURSE) {
    throw new Error(
      `この授業のペルソナは最大${MAX_PERSONAS_PER_COURSE}体までです(現在${existing.length}体)。不要なものを削除してから、もう一度お試しください。`,
    );
  }

  const drafts = await recommendPersonaDrafts({
    course,
    materialText: (chunkRows ?? []).map((c) => c.content).join("\n\n"),
    count,
    existing: existing.map((p) => ({
      name: p.name,
      role: (p.profile as { role?: string } | null)?.role ?? "",
      position: (p.stance as { position?: string } | null)?.position ?? "",
    })),
    hint: hint || undefined,
  });

  const { error } = await admin.from("personas").insert(
    drafts.map((d) => ({
      course_id: courseId,
      name: d.name,
      tier: "rag_initial",
      status: "draft",
      profile: {
        role: d.role,
        developmentalStage: d.developmentalStage,
        existingKnowledge: d.existingKnowledge,
        tone: d.tone,
      },
      stance: { position: d.stancePosition, goal: d.stanceGoal },
      behavior_rules: {
        speakingFrequency: d.speakingFrequency,
        teachingDegree: d.teachingDegree,
        interventionCondition: d.interventionCondition,
        thinkingDepth: d.thinkingDepth,
        replyTempo: d.replyTempo,
      },
      origin_note: `AI推薦(授業設定と資料から生成): ${d.rationale}`,
    })),
  );
  if (error) {
    throw new Error(`ペルソナ案の保存に失敗しました: ${error.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}

export async function generateEvolvedPersonasAction(courseId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();
  await assertOwnsCourse(admin, courseId, user.id);

  const { log, studentCount } = await buildCourseActivityLog(admin, courseId);

  if (studentCount < MIN_STUDENTS_FOR_EVOLVED) {
    throw new Error(
      `学習進化型ペルソナの生成には、同意済みの学習者が最低${MIN_STUDENTS_FOR_EVOLVED}人分の活動記録が必要です` +
        `(現在: ${studentCount}人。特定の学習者の発言だと推測されにくくするための下限です)。`,
    );
  }
  if (!log) {
    throw new Error("学習者の活動記録がまだありません。");
  }

  const result = await generateEvolvedRoles(log);

  if (result.corpusEntries.length > 0) {
    const { error: corpusError } = await admin.from("learner_corpus_entries").insert(
      result.corpusEntries.map((entry) => ({
        course_id: courseId,
        topic: entry.topic,
        misconception: entry.misconception,
        effective_question: entry.effectiveQuestion,
      })),
    );
    if (corpusError) {
      throw new Error(`学習者由来コーパスの保存に失敗しました: ${corpusError.message}`);
    }
  }

  // 手順4: 教師が承認したものだけを次の学習者に提供する。既存のF04承認ワークフローに乗せるため、
  // status='draft'で作成する(教師がペルソナ設定画面で確認・承認・有効化する)。
  const { error: personaError } = await admin.from("personas").insert(
    result.rolePersonas.map((role) => ({
      course_id: courseId,
      name: role.name,
      tier: "evolved",
      status: "draft",
      profile: { role: role.name, developmentalStage: "", existingKnowledge: "", tone: role.tone },
      stance: { position: role.viewpointSummary, goal: "" },
      behavior_rules: {
        speakingFrequency: "普通",
        teachingDegree: "問い返すのみ",
        interventionCondition: "",
      },
      origin_note: role.rationale,
    })),
  );
  if (personaError) {
    throw new Error(`学習進化型ペルソナの作成に失敗しました: ${personaError.message}`);
  }

  revalidatePath(`/courses/${courseId}/personas`);
}
