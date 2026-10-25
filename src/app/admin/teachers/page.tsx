import { getT } from "@/lib/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { approveTeacherAction, rejectTeacherAction } from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 管理者専用: 教師の自己登録(サインアップ)の承認。
export default async function AdminTeachersPage() {
  await requireAdmin();
  const { t } = await getT();
  const admin = createAdminClient();

  const { data: teachers } = await admin
    .from("profiles")
    .select("id, display_name, email, approval_status, created_at")
    .eq("role", "teacher")
    .in("approval_status", ["pending", "rejected"])
    .order("created_at", { ascending: true });

  const pending = (teachers ?? []).filter((tc) => tc.approval_status === "pending");
  const rejected = (teachers ?? []).filter((tc) => tc.approval_status === "rejected");

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("lessonCrumbs.courseList"), href: "/courses" }]} current={t("adminTeachers.title")} />

      <h1 className="text-2xl font-semibold text-ink">{t("adminTeachers.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("adminTeachers.lead")}
      </p>

      <h2 className="mt-8 text-sm font-medium text-ink">{t("adminTeachers.pendingHeading", { n: pending.length })}</h2>
      <ul className="mt-2 space-y-2">
        {pending.map((tc) => (
          <li key={tc.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line px-4 py-3 text-sm">
            <span>
              <span className="font-medium text-ink">{tc.display_name}</span>
              <span className="ml-2 text-ink-muted">{tc.email}</span>
              <span className="ml-2 text-xs text-ink-faint">{t("adminTeachers.registered", { date: tc.created_at.slice(0, 10) })}</span>
            </span>
            <span className="flex items-center gap-2">
              <form action={approveTeacherAction.bind(null, tc.id)}>
                <button
                  type="submit"
                  className="rounded-md bg-accent-fill px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-fill-hover"
                >
                  {t("adminTeachers.approve")}
                </button>
              </form>
              <form action={rejectTeacherAction.bind(null, tc.id)}>
                <button type="submit" className="text-xs text-ink-faint underline underline-offset-2 hover:text-danger">
                  {t("adminTeachers.reject")}
                </button>
              </form>
            </span>
          </li>
        ))}
        {pending.length === 0 && <li className="text-sm text-ink-muted">{t("adminTeachers.nonePending")}</li>}
      </ul>

      {rejected.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-ink">{t("adminTeachers.rejectedHeading", { n: rejected.length })}</h2>
          <ul className="mt-2 space-y-2">
            {rejected.map((tc) => (
              <li key={tc.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
                <span className="text-ink-muted">
                  {tc.display_name} {tc.email}
                </span>
                <form action={approveTeacherAction.bind(null, tc.id)}>
                  <button type="submit" className="text-xs text-ink-faint underline underline-offset-2">
                    {t("adminTeachers.reapprove")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
