import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { requestCrossOrgAccessAction, duplicatePersonaAction, duplicateMaterialAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { loadLessonLabels } from "@/lib/courses/series";
import { Breadcrumbs } from "@/components/breadcrumbs";

// F21: 教員協働のペルソナ・教材ライブラリ共有。
// 「教員(授業者)が、単元の対応表や擬似メンバー設定を学校・地域をまたいで複製・共有し、
// 互いの実践を参照しながら教材とペルソナを育てられるようにする」(要件定義書4章)。
// 同じ組織のアイテムは即時複製できる(自動許可)。他組織のアイテムは、まずリクエストを送り、
// 相手組織の承認者(/organizationで設定)が承認してから複製できるようになる。

interface SharedPersonaRow {
  id: string;
  name: string;
  profile: { role?: string } | null;
  course_id: string;
  shared_at: string;
}

interface SharedMaterialRow {
  id: string;
  title: string;
  course_id: string;
  shared_at: string;
}

type ShareStatus = "none" | "pending" | "approved" | "declined";

export default async function LibraryPage() {
  const { user } = await requireRole("teacher");
  const admin = createAdminClient();

  const { data: myProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  const myOrgId = myProfile?.organization_id ?? null;

  const { data: myCourseRows } = await admin
    .from("courses")
    .select("id")
    .eq("owner_teacher_id", user.id)
    .order("created_at", { ascending: false });
  const myLessonLabels = await loadLessonLabels(admin, (myCourseRows ?? []).map((c) => c.id));
  const myCourses = (myCourseRows ?? []).map((c) => ({ id: c.id, title: myLessonLabels.get(c.id) ?? "" }));

  const { data: sharedPersonas } = await admin
    .from("personas")
    .select("id, name, profile, course_id, shared_at")
    .not("shared_at", "is", null);
  const { data: sharedMaterials } = await admin
    .from("course_materials")
    .select("id, title, course_id, shared_at")
    .not("shared_at", "is", null)
    .eq("kind", "syllabus");

  const allCourseIds = [
    ...new Set([...(sharedPersonas ?? []).map((p) => p.course_id), ...(sharedMaterials ?? []).map((m) => m.course_id)]),
  ];
  const courseOwner = new Map<string, string>();
  const courseTitle = new Map<string, string>();
  if (allCourseIds.length > 0) {
    const { data: courses } = await admin
      .from("courses")
      .select("id, owner_teacher_id")
      .in("id", allCourseIds);
    const labels = await loadLessonLabels(admin, allCourseIds);
    for (const c of courses ?? []) {
      courseOwner.set(c.id, c.owner_teacher_id);
      courseTitle.set(c.id, labels.get(c.id) ?? "");
    }
  }

  const ownerTeacherIds = [...new Set(courseOwner.values())];
  const teacherOrg = new Map<string, string | null>();
  const teacherName = new Map<string, string>();
  if (ownerTeacherIds.length > 0) {
    const { data: teachers } = await admin
      .from("profiles")
      .select("id, display_name, email, organization_id")
      .in("id", ownerTeacherIds);
    for (const t of teachers ?? []) {
      teacherOrg.set(t.id, t.organization_id);
      teacherName.set(t.id, t.display_name || t.email || "(不明)");
    }
  }

  const { data: myRequests } = await admin
    .from("share_requests")
    .select("item_kind, item_id, status")
    .eq("requester_teacher_id", user.id);
  const requestStatus = new Map<string, ShareStatus>();
  for (const r of myRequests ?? []) {
    requestStatus.set(`${r.item_kind}:${r.item_id}`, r.status as ShareStatus);
  }

  const classify = (courseId: string) => {
    const ownerId = courseOwner.get(courseId);
    const ownerOrgId = ownerId ? (teacherOrg.get(ownerId) ?? null) : null;
    const isOwn = ownerId === user.id;
    const sameOrg = !isOwn && myOrgId !== null && ownerOrgId === myOrgId;
    return { ownerId, ownerOrgId, isOwn, sameOrg };
  };

  const personaRows = (sharedPersonas ?? []) as SharedPersonaRow[];
  const materialRows = (sharedMaterials ?? []) as SharedMaterialRow[];

  const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
    none: "",
    pending: "承認待ち",
    approved: "承認済み(複製できます)",
    declined: "見送られました",
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "教科・科目一覧", href: "/courses" }]} current="共有ライブラリ" />
      <h1 className="mt-3 text-2xl font-semibold text-ink">共有ライブラリ</h1>
      <p className="mt-1 text-sm text-ink-muted">
        他の教師が公開したペルソナ・教材(単元の対応表)を自分の授業に複製できる。同じ組織なら
        即時複製、他組織なら
        <Link href="/organization" className="mx-1 underline">
          組織の承認者
        </Link>
        の承認が必要。
      </p>
      {!myOrgId && (
        <p className="mt-2 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          まだ組織に参加していません。
          <Link href="/organization" className="ml-1 underline">
            組織に参加する
          </Link>
          と、同じ組織の共有アイテムを承認不要で複製できるようになります。
        </p>
      )}

      <h2 className="mt-8 text-sm font-medium text-ink">
        共有されているペルソナ({personaRows.length}件)
      </h2>
      <ul className="mt-3 space-y-3">
        {personaRows.map((persona) => {
          const { ownerId, isOwn, sameOrg } = classify(persona.course_id);
          const key = `persona:${persona.id}`;
          const status = requestStatus.get(key) ?? "none";
          const canDuplicate = isOwn ? false : sameOrg || status === "approved";
          const boundDuplicate = duplicatePersonaAction.bind(null, persona.id);
          const boundRequest = requestCrossOrgAccessAction.bind(null, "persona", persona.id);

          return (
            <li key={persona.id} className="rounded-md border border-line px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {persona.name}
                  {persona.profile?.role && <span className="ml-2 text-ink-muted">({persona.profile.role})</span>}
                </span>
                {isOwn && <span className="text-xs text-ink-faint">自分の共有</span>}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                公開元: {ownerId ? teacherName.get(ownerId) : "(不明)"} ・ {courseTitle.get(persona.course_id)}
                {!isOwn && (sameOrg ? "(同じ組織)" : "(他組織)")}
              </p>

              {!isOwn && canDuplicate && (
                <form action={boundDuplicate} className="mt-2 flex items-center gap-2">
                  <select
                    name="targetCourseId"
                    required
                    defaultValue=""
                    aria-label="複製先の授業"
                    className="rounded-md border border-line px-2 py-1 text-xs bg-surface-raised"
                  >
                    <option value="" disabled>
                      複製先の授業
                    </option>
                    {(myCourses ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <SubmitButton
                    pendingText="複製中…"
                    className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
                  >
                    複製する
                  </SubmitButton>
                </form>
              )}
              {!isOwn && !sameOrg && status === "none" && (
                <form action={boundRequest} className="mt-2">
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                  >
                    共有をリクエストする
                  </button>
                </form>
              )}
              {!isOwn && !sameOrg && status !== "none" && (
                <p className="mt-2 text-xs text-ink-muted">{SHARE_STATUS_LABELS[status]}</p>
              )}
            </li>
          );
        })}
        {personaRows.length === 0 && <li className="text-sm text-ink-muted">共有されているペルソナはありません。</li>}
      </ul>

      <h2 className="mt-8 text-sm font-medium text-ink">
        共有されている教材・単元の対応表({materialRows.length}件)
      </h2>
      <ul className="mt-3 space-y-3">
        {materialRows.map((material) => {
          const { ownerId, isOwn, sameOrg } = classify(material.course_id);
          const key = `material:${material.id}`;
          const status = requestStatus.get(key) ?? "none";
          const canDuplicate = isOwn ? false : sameOrg || status === "approved";
          const boundDuplicate = duplicateMaterialAction.bind(null, material.id);
          const boundRequest = requestCrossOrgAccessAction.bind(null, "material", material.id);

          return (
            <li key={material.id} className="rounded-md border border-line px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-ink">{material.title}</span>
                {isOwn && <span className="text-xs text-ink-faint">自分の共有</span>}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                公開元: {ownerId ? teacherName.get(ownerId) : "(不明)"} ・ {courseTitle.get(material.course_id)}
                {!isOwn && (sameOrg ? "(同じ組織)" : "(他組織)")}
              </p>

              {!isOwn && canDuplicate && (
                <form action={boundDuplicate} className="mt-2 flex items-center gap-2">
                  <select
                    name="targetCourseId"
                    required
                    defaultValue=""
                    aria-label="複製先の授業"
                    className="rounded-md border border-line px-2 py-1 text-xs bg-surface-raised"
                  >
                    <option value="" disabled>
                      複製先の授業
                    </option>
                    {(myCourses ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <SubmitButton
                    pendingText="複製中…"
                    className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
                  >
                    複製する
                  </SubmitButton>
                </form>
              )}
              {!isOwn && !sameOrg && status === "none" && (
                <form action={boundRequest} className="mt-2">
                  <button
                    type="submit"
                    className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface"
                  >
                    共有をリクエストする
                  </button>
                </form>
              )}
              {!isOwn && !sameOrg && status !== "none" && (
                <p className="mt-2 text-xs text-ink-muted">{SHARE_STATUS_LABELS[status]}</p>
              )}
            </li>
          );
        })}
        {materialRows.length === 0 && <li className="text-sm text-ink-muted">共有されている教材はありません。</li>}
      </ul>
    </div>
  );
}
