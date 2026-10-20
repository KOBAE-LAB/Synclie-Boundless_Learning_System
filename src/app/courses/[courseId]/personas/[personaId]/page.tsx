import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { updatePersonaAction } from "../actions";
import { PersonaForm, type PersonaFormValues } from "../persona-form";
import { loadLessonCrumbs } from "@/lib/courses/series";
import { Breadcrumbs } from "@/components/breadcrumbs";

interface PersonaRow {
  id: string;
  name: string;
  course_id: string;
  profile: { role?: string; developmentalStage?: string; existingKnowledge?: string; tone?: string } | null;
  stance: { position?: string; goal?: string } | null;
  behavior_rules: {
    speakingFrequency?: string;
    teachingDegree?: string;
    interventionCondition?: string;
    thinkingDepth?: string;
    replyTempo?: string;
  } | null;
}

export default async function EditPersonaPage({
  params,
}: {
  params: Promise<{ courseId: string; personaId: string }>;
}) {
  const { courseId, personaId } = await params;
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

  const { data: persona } = await admin
    .from("personas")
    .select("id, name, course_id, profile, stance, behavior_rules")
    .eq("id", personaId)
    .maybeSingle<PersonaRow>();

  if (!persona || persona.course_id !== courseId) {
    notFound();
  }

  const defaultValues: Partial<PersonaFormValues> = {
    name: persona.name,
    role: persona.profile?.role,
    developmentalStage: persona.profile?.developmentalStage,
    existingKnowledge: persona.profile?.existingKnowledge,
    tone: persona.profile?.tone,
    stancePosition: persona.stance?.position,
    stanceGoal: persona.stance?.goal,
    speakingFrequency: persona.behavior_rules?.speakingFrequency,
    teachingDegree: persona.behavior_rules?.teachingDegree,
    interventionCondition: persona.behavior_rules?.interventionCondition,
    thinkingDepth: persona.behavior_rules?.thinkingDepth,
    replyTempo: persona.behavior_rules?.replyTempo,
  };

  const boundUpdateAction = updatePersonaAction.bind(null, courseId, personaId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[...((await loadLessonCrumbs(admin, courseId))?.teacherTrail ?? []), { label: "ペルソナ設定", href: `/courses/${courseId}/personas` }]} current={persona.name} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {persona.name} を編集
      </h1>

      <div className="mt-8 rounded-lg border border-line p-5">
        <PersonaForm
          action={boundUpdateAction}
          submitLabel="更新する"
          defaultValues={defaultValues}
        />
      </div>
    </div>
  );
}
