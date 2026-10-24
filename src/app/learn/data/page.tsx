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

  const isActive = isConsentCurrent(consent);
  const reconsent = needsReconsent(consent);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Breadcrumbs trail={[{ label: "授業一覧", href: "/learn" }]} current="自分のデータ" />
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        自分のデータ
      </h1>

      <div className="mt-6 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-sm font-medium text-ink">同意の状況</h2>
        {!consent && <p className="mt-2 text-ink-muted">まだ同意していません。</p>}
        {consent && reconsent && (
          <p className="mt-2 text-warn">同意の内容(AIの利用についての説明)が更新されました。内容を確認して、もう一度同意してください。</p>
        )}
        {consent && !reconsent && (
          <p className="mt-2 text-ink-muted">
            {isActive
              ? `${new Date(consent.granted_at).toLocaleString("ja-JP")} に同意済みです。`
              : `${new Date(consent.withdrawn_at!).toLocaleString("ja-JP")} に利用を停止しています。`}
          </p>
        )}

        {isActive ? (
          <form action={withdrawConsentAction} className="mt-4">
            <button
              type="submit"
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
            >
              利用を停止する(同意を撤回)
            </button>
          </form>
        ) : (
          <Link
            href="/consent"
            className="mt-4 inline-block rounded-md bg-accent-fill px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-fill-hover"
          >
            同意して利用を再開する
          </Link>
        )}
      </div>

      {isActive && (
        <div className="mt-6 rounded-lg border border-line p-5 text-sm">
          <h2 className="text-sm font-medium text-ink">他の学校でも使うことへの同意(任意)</h2>
          <p className="mt-2 text-ink-muted">
            あなたの探究の記録をもとに、先生が「先輩のAI」をつくります。同意すると、他の学校(同じ自治体など)の後輩も、そのAIと対話できます。
          </p>
          <details className="mt-2 text-ink-muted">
            <summary className="cursor-pointer underline underline-offset-2">くわしく読む</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>他の学校には、学校名・地名・人の名前などをぼかした、短い語りだけが使われます。</li>
              <li>先輩のAIは、あなた本人ではなく、記録をもとにしたAIです。</li>
              <li>同意しなくても、授業や、同じ学校での利用には影響しません。</li>
              <li>いつでも取り消せます。取り消すと、他の学校では使われなくなります。</li>
            </ul>
          </details>
          <p className="mt-2 text-ink-muted">
            {wideActive
              ? `${new Date(wide!.granted_at).toLocaleString("ja-JP")} に同意済みです。`
              : wide?.withdrawn_at
                ? `${new Date(wide.withdrawn_at).toLocaleString("ja-JP")} に取り消しました。`
                : "いまは、同意していません。"}
          </p>
          {wideActive ? (
            <form action={withdrawWideConsentAction} className="mt-3">
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                他の学校で使うことへの同意を取り消す
              </button>
            </form>
          ) : (
            <form action={grantWideConsentAction} className="mt-3">
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
                他の学校でも使うことに同意する
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-sm font-medium text-ink">
          保存されているデータ
        </h2>
        <ul className="mt-2 space-y-1 text-ink-muted">
          <li>学習セッション: {sessionCount ?? 0}件(擬似メンバーとの対話ログを含む)</li>
          <li>あなたの発言: {authoredTurnCount ?? 0}件(グループの議論の発言を含む。削除すると、グループの議論からはあなたの発言だけが消えます)</li>
          <li>提出した成果: {submissionCount ?? 0}件</li>
          <li>振り返り: {reflectionCount ?? 0}件</li>
          <li>学習者プロファイル: {profileCount ?? 0}件</li>
        </ul>

        <form action={deleteMyDataAction} className="mt-4">
          <p className="mb-2 text-xs text-danger">
            削除すると元に戻せません。ログインアカウント自体は残ります。
          </p>
          <button
            type="submit"
            className="rounded-md border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
          >
            すべてのデータを削除する
          </button>
        </form>
      </div>
    </div>
  );
}
