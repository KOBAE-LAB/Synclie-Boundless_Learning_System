"use server";

import { getT } from "@/lib/i18n/server";
import type { DictKey, Vars } from "@/lib/i18n/translate";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { assertOwnsCourse } from "@/lib/courses/ownership";

// 画面の言語でのメッセージ(エラーなど)。
async function msg(key: DictKey, vars?: Vars): Promise<string> {
  return (await getT()).t(key, vars);
}

type AdminClient = ReturnType<typeof createAdminClient>;
type ItemKind = "persona" | "material";

// F21: 共有ライブラリのアイテム(公開済みのペルソナ or 教材)の所属組織を、
// 所有者の授業→教師→組織 の経路でたどる(item自体には組織を持たせない)。
async function getItemOwnerOrganization(
  admin: AdminClient,
  itemKind: ItemKind,
  itemId: string,
): Promise<{ courseId: string; ownerTeacherId: string; ownerOrganizationId: string | null } | null> {
  const table = itemKind === "persona" ? "personas" : "course_materials";
  const { data: item } = await admin
    .from(table)
    .select("id, course_id, shared_at")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || !item.shared_at) return null;

  const { data: course } = await admin
    .from("courses")
    .select("id, owner_teacher_id")
    .eq("id", item.course_id)
    .maybeSingle();
  if (!course) return null;

  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", course.owner_teacher_id)
    .maybeSingle();

  return {
    courseId: course.id,
    ownerTeacherId: course.owner_teacher_id,
    ownerOrganizationId: ownerProfile?.organization_id ?? null,
  };
}

// F21: 他組織の共有アイテムへのアクセスをリクエストする。同一組織内は自動許可のため、
// このアクションは組織が異なる場合にだけ使う(呼び出し側でも判定するが、ここでも二重に確認する)。
export async function requestCrossOrgAccessAction(itemKind: ItemKind, itemId: string) {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const { data: myProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!myProfile?.organization_id) {
    throw new Error((await msg("libraryActions.joinFirst")));
  }

  const owner = await getItemOwnerOrganization(admin, itemKind, itemId);
  if (!owner) {
    throw new Error((await msg("libraryActions.itemNotFound")));
  }
  if (!owner.ownerOrganizationId) {
    throw new Error((await msg("libraryActions.ownerNoOrg")));
  }
  if (owner.ownerOrganizationId === myProfile.organization_id) {
    throw new Error((await msg("libraryActions.sameOrgNoReq")));
  }

  const { data: existing } = await admin
    .from("share_requests")
    .select("id, status")
    .eq("requester_teacher_id", user.id)
    .eq("item_kind", itemKind)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && existing.status === "pending") {
    throw new Error((await msg("libraryActions.alreadyReq")));
  }

  const { error } = await admin.from("share_requests").insert({
    requester_teacher_id: user.id,
    requester_organization_id: myProfile.organization_id,
    owner_organization_id: owner.ownerOrganizationId,
    item_kind: itemKind,
    item_id: itemId,
  });
  if (error) {
    throw new Error(await msg("libraryActions.reqFailed", { message: error.message }));
  }

  revalidatePath("/library");
}

// F21: 共有ライブラリのペルソナを、自分の授業に複製する。
// 同一組織なら即時、他組織なら承認済みの共有リクエストが必要。
export async function duplicatePersonaAction(personaId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const targetCourseId = String(formData.get("targetCourseId") ?? "").trim();
  if (!targetCourseId) {
    throw new Error((await msg("libraryActions.pickTarget")));
  }

  const admin = createAdminClient();
  await assertOwnsCourse(admin, targetCourseId, user.id);
  await assertCanDuplicate(admin, user.id, "persona", personaId);

  const { data: source } = await admin
    .from("personas")
    .select("name, profile, stance, behavior_rules")
    .eq("id", personaId)
    .single();

  const sourceTeacherName = await getSourceTeacherLabel(admin, "persona", personaId);

  const { error } = await admin.from("personas").insert({
    course_id: targetCourseId,
    name: source!.name,
    tier: "teacher_defined",
    status: "draft",
    profile: source!.profile,
    stance: source!.stance,
    behavior_rules: source!.behavior_rules,
    origin_note: await msg("libraryActions.originNote", { who: sourceTeacherName }),
  });
  if (error) {
    throw new Error(await msg("libraryActions.copyFailed", { message: error.message }));
  }

  revalidatePath(`/courses/${targetCourseId}/personas`);
  revalidatePath("/library");
}

// F21: 共有ライブラリの教材(単元の対応表)を、自分の授業に複製する。
// storage_pathがある場合はStorage上のファイルも複製する。RAGは複製先で改めて生成する。
export async function duplicateMaterialAction(materialId: string, formData: FormData) {
  const { user } = await requireRole("teacher");
  const targetCourseId = String(formData.get("targetCourseId") ?? "").trim();
  if (!targetCourseId) {
    throw new Error((await msg("libraryActions.pickTarget")));
  }

  const admin = createAdminClient();
  await assertOwnsCourse(admin, targetCourseId, user.id);
  await assertCanDuplicate(admin, user.id, "material", materialId);

  const { data: source } = await admin
    .from("course_materials")
    .select("title, kind, storage_path, source_url")
    .eq("id", materialId)
    .single();

  let newStoragePath: string | null = null;
  if (source!.storage_path) {
    const safeName = source!.storage_path.split("/").pop() ?? "material";
    newStoragePath = `${targetCourseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: copyError } = await admin.storage
      .from("materials")
      .copy(source!.storage_path, newStoragePath);
    if (copyError) {
      throw new Error(await msg("libraryActions.fileCopyFailed", { message: copyError.message }));
    }
  }

  const sourceTeacherName = await getSourceTeacherLabel(admin, "material", materialId);

  const { error } = await admin.from("course_materials").insert({
    course_id: targetCourseId,
    uploaded_by: user.id,
    kind: source!.kind,
    title: await msg("libraryActions.copiedTitle", { title: source!.title, who: sourceTeacherName }),
    storage_path: newStoragePath,
    source_url: source!.source_url,
  });
  if (error) {
    throw new Error(await msg("libraryActions.copyFailed", { message: error.message }));
  }

  revalidatePath(`/courses/${targetCourseId}`);
  revalidatePath("/library");
}

async function assertCanDuplicate(admin: AdminClient, teacherId: string, itemKind: ItemKind, itemId: string) {
  const { data: myProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", teacherId)
    .maybeSingle();

  const owner = await getItemOwnerOrganization(admin, itemKind, itemId);
  if (!owner) {
    throw new Error((await msg("libraryActions.itemNotFound")));
  }

  const sameOrg =
    myProfile?.organization_id && owner.ownerOrganizationId && myProfile.organization_id === owner.ownerOrganizationId;
  if (sameOrg) return;

  const { data: approvedRequest } = await admin
    .from("share_requests")
    .select("id")
    .eq("requester_teacher_id", teacherId)
    .eq("item_kind", itemKind)
    .eq("item_id", itemId)
    .eq("status", "approved")
    .maybeSingle();
  if (!approvedRequest) {
    throw new Error((await msg("libraryActions.needApproval")));
  }
}

async function getSourceTeacherLabel(admin: AdminClient, itemKind: ItemKind, itemId: string) {
  const owner = await getItemOwnerOrganization(admin, itemKind, itemId);
  if (!owner) return (await msg("libraryActions.unknown"));
  const { data: teacher } = await admin
    .from("profiles")
    .select("display_name, email")
    .eq("id", owner.ownerTeacherId)
    .maybeSingle();
  return teacher?.display_name || teacher?.email || (await msg("libraryActions.unknown"));
}
