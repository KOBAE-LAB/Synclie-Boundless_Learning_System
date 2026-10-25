import { formatDateTime, getT } from "@/lib/i18n/server";
import Link from "next/link";
import { isConsentCurrent, needsReconsent } from "@/lib/consent";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { withdrawConsentAction, deleteMyDataAction, grantWideConsentAction, withdrawWideConsentAction } from "./actions";
import { Breadcrumbs } from "@/components/breadcrumbs";

// F16: 同意・データ管理。学習者が自分のデータの状況を確認し、
// 利用を停止(同意を撤回)したり、蓄積したデータを削除したりできる画面。
// 同意状況に関わらずアクセスできる(同意していない/撤回した学習者もここは使える)。
export default async function MyDataPage() {
  const { user } = await requireRole("student");

  const admin = createAdminClient();
  const { data: consent } = await admin
    .from("consent_records")
    .select("granted_at, withdrawn_at")
    .eq("student_id", user.id)
    .eq("scope", "data_use")
    .maybeSingle();

  const { data: wide } = await admin
    .from("consent_records")
    .select("granted_at, withdrawn_at")
    .eq("student_id", user.id)
    .eq("scope", "share_wide")
    .maybeSingle();
  const wideActive = Boolean(wide && wide.granted_at && !wide.withdrawn_at);

  const { count: sessionCount } = await admin
    .from("learning_sessions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);
  // 探究のグループの議論での本人の発言(議論はメンバーと共有。削除すると本人の発言だけが消える)。
  const { count: authoredTurnCount } = await admin
    .from("dialogue_turns")
    .select("id", { count: "exact", head: true })
    .eq("author_student_id", user.id);
  const { count: submissionCount } = await admin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);
  const { count: reflectionCount } = await admin
    .from("reflections")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);
  const { count: profileCount } = await admin
    .from("student_profiles")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);

  const { t, lang } = await getT();
  const isActive = isConsentCurrent(consent);
  const reconsent = needsReconsent(consent);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: t("learnList.title"), href: "/learn" }]} current={t("myData.title")} />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {t("myData.title")}
      </h1>

      <div className="mt-6 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-sm font-medium text-ink">{t("myData.consentStatus")}</h2>
        {!consent && <p className="mt-2 text-ink-muted">{t("myData.notYet")}</p>}
        {consent && reconsent && (
          <p className="mt-2 text-warn">{t("myData.updated")}</p>
        )}
        {consent && !reconsent && (
          <p className="mt-2 text-ink-muted">
            {isActive
              ? t("myData.agreedAt", { date: formatDateTime(consent.granted_at, lang) })
              : t("myData.stoppedAt", { date: formatDateTime(consent.withdrawn_at!, lang) })}
          </p>
        )}

        {isActive ? (
          <form action={withdrawConsentAction} className="mt-4">
            <button
              type="submit"
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
            >
              {t("myData.withdraw")}
            </button>
          </form>
        ) : (
          <Link
            href="/consent"
            className="mt-4 inline-block rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
          >
            {t("myData.resume")}
          </Link>
        )}
      </div>

      {isActive && (
        <div className="mt-6 rounded-lg border border-line p-5 text-sm">
          <h2 className="text-sm font-medium text-ink">{t("myData.wideTitle")}</h2>
          <p className="mt-2 text-ink-muted">
            {t("myData.wideLead")}
          </p>
          <details className="mt-2 text-ink-muted">
            <summary className="cursor-pointer underline underline-offset-2">{t("myData.wideMore")}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t("myData.wide1")}</li>
              <li>{t("myData.wide2")}</li>
              <li>{t("myData.wide3")}</li>
              <li>{t("myData.wide4")}</li>
            </ul>
          </details>
          <p className="mt-2 text-ink-muted">
            {wideActive
              ? t("myData.wideAgreedAt", { date: formatDateTime(wide!.granted_at, lang) })
              : wide?.withdrawn_at
                ? t("myData.wideWithdrawnAt", { date: formatDateTime(wide.withdrawn_at, lang) })
                : t("myData.wideNone")}
          </p>
          {wideActive ? (
            <form action={withdrawWideConsentAction} className="mt-3">
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                {t("myData.wideWithdraw")}
              </button>
            </form>
          ) : (
            <form action={grantWideConsentAction} className="mt-3">
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                {t("myData.wideGrant")}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-sm font-medium text-ink">
          {t("myData.storedHeading")}
        </h2>
        <ul className="mt-2 space-y-1 text-ink-muted">
          <li>{t("myData.sessions", { n: sessionCount ?? 0 })}</li>
          <li>{t("myData.posts", { n: authoredTurnCount ?? 0 })}</li>
          <li>{t("myData.submissions", { n: submissionCount ?? 0 })}</li>
          <li>{t("myData.reflections", { n: reflectionCount ?? 0 })}</li>
          <li>{t("myData.profiles", { n: profileCount ?? 0 })}</li>
        </ul>

        <form action={deleteMyDataAction} className="mt-4">
          <p className="mb-2 text-xs text-danger">
            {t("myData.deleteWarn")}
          </p>
          <button
            type="submit"
            className="rounded-md border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            {t("myData.deleteAll")}
          </button>
        </form>
      </div>
    </div>
  );
}
