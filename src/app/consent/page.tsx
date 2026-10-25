import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { isConsentCurrent, needsReconsent } from "@/lib/consent";
import { SubmitButton } from "@/components/submit-button";
import { grantConsentAction } from "./actions";
import { formatDateTime, getT } from "@/lib/i18n/server";

// 同意の取得(データの利用とAIの利用)。学習者は、この内容に同意しないと対話・提出などの画面
// (/learn以下)を使えない(src/lib/consent.ts の requireConsent がここへ誘導する)。
// 説明文を大きく変えたら、src/lib/consent.ts の CONSENT_TEXT_UPDATED_AT を新しくする
// (それより前に同意した学習者は、もう一度同意することになる)。
export default async function ConsentPage() {
  const { user } = await requireRole("student");

  const admin = createAdminClient();
  const { data: consent } = await admin
    .from("consent_records")
    .select("granted_at, withdrawn_at")
    .eq("student_id", user.id)
    .eq("scope", "data_use")
    .maybeSingle();

  const { t, lang } = await getT();
  const isActive = isConsentCurrent(consent);
  const reconsent = needsReconsent(consent);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">{t("consent.title")}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t("consent.intro")}</p>

      {reconsent && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          {t("consent.updated")}
        </p>
      )}

      <section className="mt-6 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">{t("consent.s1Title")}</h2>
        <p>{t("consent.s1Body")}</p>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">{t("consent.s2Title")}</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>{t("consent.s2UseLabel")}</b>: {t("consent.s2UseBody")}
          </li>
          <li>
            <b>{t("consent.s2SendLabel")}</b>: {t("consent.s2SendBody")}
            <b>{t("consent.s2SendBold")}</b>
          </li>
          <li>
            <b>{t("consent.s2WhereLabel")}</b>: {t("consent.s2WhereA")}
            <b>{t("consent.s2WhereBold")}</b>
            {t("consent.s2WhereB")}
          </li>
          <li>
            <b>{t("consent.s2OpenAiLabel")}</b>: {t("consent.s2OpenAiBody")}
          </li>
          <li>
            <b>{t("consent.s2MistakeBold")}</b>
            {t("consent.s2MistakeBody")}
          </li>
          <li>
            <b>{t("consent.s2AvoidLabel")}</b>: {t("consent.s2AvoidBody")}
          </li>
        </ul>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">{t("consent.s3Title")}</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("consent.s3a")}</li>
          <li>{t("consent.s3b")}</li>
          <li>{t("consent.s3c")}</li>
        </ul>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">{t("consent.s4Title")}</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("consent.s4a")}</li>
          <li>{t("consent.s4b")}</li>
        </ul>
        <p className="pt-1 text-xs text-ink-muted">
          {t("consent.s4MinorsA")}
          <Link href="/privacy" className="underline">
            {t("consent.s4Privacy")}
          </Link>
          {t("consent.s4MinorsB")}
        </p>
      </section>

      {isActive ? (
        <p className="mt-6 text-sm text-ink-muted">
          {t("consent.agreedAt", { date: formatDateTime(consent!.granted_at, lang) })}
          <Link href="/learn" className="ml-2 underline underline-offset-2">
            {t("consent.toLessons")}
          </Link>
        </p>
      ) : (
        <form action={grantConsentAction} className="mt-6">
          <SubmitButton
            pendingText={t("consent.submitting")}
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            {t("consent.submit")}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
