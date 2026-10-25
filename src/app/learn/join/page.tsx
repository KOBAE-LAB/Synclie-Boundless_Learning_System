import { requireRole } from "@/lib/auth/session";
import { requireConsent } from "@/lib/consent";
import { createAdminClient } from "@/lib/supabase/server";
import { joinCourseByCodeAction } from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SubmitButton } from "@/components/submit-button";
import { getT } from "@/lib/i18n/server";

// 履修登録。教師から伝えられた授業コードを入力して、教科・科目を履修する。
export default async function JoinCoursePage() {
  const { user } = await requireRole("student");
  const admin = createAdminClient();
  await requireConsent(admin, user.id);
  const { t } = await getT();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("learnList.title"), href: "/learn" }]} current={t("join.title")} />

      <h1 className="text-2xl font-semibold text-ink">{t("join.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("join.lead")}
      </p>

      <form action={joinCourseByCodeAction} className="mt-6 space-y-3">
        <label htmlFor="join-code" className="sr-only">
          {t("join.codeLabel")}
        </label>
        <input
          id="join-code"
          name="code"
          required
          placeholder={t("join.placeholder")}
          autoCapitalize="characters"
          className="w-full rounded-md border border-line px-3 py-2 text-sm uppercase tracking-widest bg-surface-raised"
        />
        <SubmitButton
          pendingText={t("join.submitting")}
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-60"
        >
          {t("join.submit")}
        </SubmitButton>
      </form>
    </div>
  );
}
