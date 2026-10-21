import Link from "next/link";
import { isConsentCurrent, needsReconsent } from "@/lib/consent";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { withdrawConsentAction, deleteMyDataAction } from "./actions";
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
    .maybeSingle();

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
