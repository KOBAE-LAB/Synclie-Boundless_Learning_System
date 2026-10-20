import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/server";
import { isConsentCurrent, needsReconsent } from "@/lib/consent";
import { SubmitButton } from "@/components/submit-button";
import { grantConsentAction } from "./actions";

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
    .maybeSingle();

  const isActive = isConsentCurrent(consent);
  const reconsent = needsReconsent(consent);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-ink">データの利用とAIについて</h1>
      <p className="mt-2 text-sm text-ink-muted">はじめる前に、次の内容を読んで、同意するか決めてください。</p>

      {reconsent && (
        <p className="mt-4 rounded-md border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          同意の内容(AIの利用についての説明)が更新されました。もう一度読んで、同意してください。
        </p>
      )}

      <section className="mt-6 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">1. 何に使うか</h2>
        <p>
          Synclieでは、あなたが授業で入力した発言・提出物・振り返りを、AIとの対話やフィードバックの生成に使い、
          あなた自身の学びの記録として残します。
        </p>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">2. AIの利用について</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>AIを使う場面</b>: 擬似メンバー(AI)との対話、成果へのフィードバック、議論のまとめや評価、
            手書きの文字起こし、音声の文字起こし、学習の振り返りの要約と、次の学びの提案(あなたが押したとき)。
          </li>
          <li>
            <b>AIに送る内容</b>: あなたが入力した発言・成果・振り返り、アップロードした手書き画像や音声、
            授業の資料の一部。<b>お名前とメールアドレスは、AIには送りません。</b>
          </li>
          <li>
            <b>送り先と保管</b>: AIの処理は、外部のサービス(OpenAI、米国の事業者)に送って行います。そのため、
            送った内容が<b>日本国外で処理される</b>ことがあります。あなたの記録そのものは、日本(東京)の
            データベースに保管します。
          </li>
          <li>
            <b>OpenAIでの扱い</b>: OpenAIの公開している方針では、このような形(API)で送られた内容は、
            既定ではAIの学習には使われません。不正利用を見つけるために、一定の期間、保管されることがあります。
            最新の内容は、OpenAIの公式の案内で確認できます。
          </li>
          <li>
            <b>AIは間違えることがあります。</b>AIのフィードバックや評価は、最終的なものではなく、考えるための
            材料です。評価の最終的な判断は、先生とあなたが行います。
          </li>
          <li>
            <b>入力しないでほしいこと</b>: 自分や他の人が特定できる情報(住所・電話番号・学校名など)や、
            他の人に知られたくないことは、書かないでください。
          </li>
        </ul>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">3. 先生が見られるもの</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>授業の中の発言・提出物・AIによる評価は、担当の先生が確認できます。</li>
          <li>振り返りは、あなた自身が「先生に共有する」を選んだものだけ、先生に見えます。</li>
          <li>ポートフォリオは、あなたが「公開用」にしたものだけ、公開リンクで他の人に見せられます。</li>
        </ul>
      </section>

      <section className="mt-4 space-y-2 rounded-lg border border-line p-5 text-sm">
        <h2 className="text-base font-semibold text-ink">4. あなたにできること</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>いつでも、自分のデータを見る・書き出す・削除する・利用を止める(同意を取り消す)ことができます。</li>
          <li>同意しない場合や、取り消した場合は、AIを使う授業の画面は使えません。</li>
        </ul>
        <p className="pt-1 text-xs text-ink-muted">
          小中学生の場合は、学校や保護者の同意のもとで利用することを前提としています。詳しくは、
          <Link href="/privacy" className="underline">
            プライバシーポリシー
          </Link>
          を読んでください。
        </p>
      </section>

      {isActive ? (
        <p className="mt-6 text-sm text-ink-muted">
          {new Date(consent!.granted_at).toLocaleString("ja-JP")} に同意済みです。
          <Link href="/learn" className="ml-2 hover:underline">
            授業一覧へ →
          </Link>
        </p>
      ) : (
        <form action={grantConsentAction} className="mt-6">
          <SubmitButton
            pendingText="記録しています…"
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover disabled:opacity-50"
          >
            内容を読んで、同意して始める
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
