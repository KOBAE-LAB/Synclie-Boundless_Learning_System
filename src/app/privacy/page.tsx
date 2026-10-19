import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = { title: "プライバシーポリシー - Synclie" };

// 下書き: 運営者(KOBAE-LAB)が内容を確認してから公開すること。
// アプリの実際の仕組み(取得する情報・AIへの送信・教師への開示・本人による削除)に沿って書いている。
export default function PrivacyPage() {
  return (
    <LegalPage title="プライバシーポリシー" updatedAt="2026年10月20日">
      <p>
        KOBAE-LAB(以下「運営者」)は、学習支援サービス「Synclie - Boundless Learning System」
        (以下「本サービス」)における、利用者の情報の取り扱いについて、次のとおり定めます。
      </p>

      <LegalSection heading="1. 取得する情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>アカウント情報: お名前(表示名)、メールアドレス、ログイン方法(パスワード、またはGoogleアカウント)</li>
          <li>
            Googleでログインした場合: Googleから提供されるお名前・メールアドレス・アカウント識別子。
            これ以外のGoogleのデータ(メール、ドライブ等)には一切アクセスしません
          </li>
          <li>授業への参加情報(どの授業に参加しているか)</li>
          <li>
            学習の記録: 授業内で入力した発言(テキスト・手書き画像・音声)、提出した成果物、振り返り、
            AIによるフィードバック・評価
          </li>
          <li>ログインの状態を保つためのCookie(広告や行動追跡の目的では使用しません)</li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. 利用目的">
        <ul className="list-disc space-y-1 pl-5">
          <li>本サービスの提供(ログイン、授業への参加、AI擬似メンバーとの対話、フィードバックの生成)</li>
          <li>担当教師が、授業の学習状況を確認し、指導に活かすこと</li>
          <li>利用者本人が、自分の学習の記録を振り返ること</li>
          <li>不正利用の防止、障害の調査、サービスの改善</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. AI(外部サービス)への送信">
        <p>
          AIとの対話やフィードバックの生成のため、利用者が入力した内容と、授業の教材の一部を、
          AIサービス(OpenAI)に送信して処理します。氏名・メールアドレスは、AIには送信しません。
          個人を特定できる情報や、他人に知られたくない情報は、入力しないでください。
        </p>
      </LegalSection>

      <LegalSection heading="4. 担当教師への開示">
        <p>
          授業の担当教師は、その授業内の発言・提出物・AIによる評価を確認できます。
          振り返りは、利用者本人が「先生に共有する」を選んだものだけが教師に表示されます。
        </p>
      </LegalSection>

      <LegalSection heading="5. 委託先・保管場所">
        <p>
          本サービスは、次の事業者のサービスを利用して運営しています。
          各社での取り扱いは、各社のプライバシーポリシーに従います。
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase(データベース・ファイルの保管。東京リージョン)</li>
          <li>さくらインターネット(アプリケーションサーバー)</li>
          <li>OpenAI(AIの処理)</li>
          <li>Google(Googleアカウントでのログイン)</li>
        </ul>
        <p>法令に基づく場合を除き、これらの目的以外で、利用者の情報を第三者に提供しません。</p>
      </LegalSection>

      <LegalSection heading="6. 利用者ご自身による確認・削除">
        <p>
          ログイン後の「自分のデータ」画面で、保存されているデータの件数の確認、データ利用への同意の
          撤回、保存データの全削除ができます。アカウント自体の削除を希望する場合は、下記の
          お問い合わせ先にご連絡ください。
        </p>
      </LegalSection>

      <LegalSection heading="7. 保存期間">
        <p>
          利用者が削除するか、運営者が削除するまで保管します。授業や運営の都合で、運営者が
          データを整理・削除することがあります。
        </p>
      </LegalSection>

      <LegalSection heading="8. 児童・生徒の利用">
        <p>
          小学生・中学生などの未成年の方は、学校や保護者の同意のもとで利用してください。
        </p>
      </LegalSection>

      <LegalSection heading="9. 改定">
        <p>本ポリシーは、必要に応じて改定します。重要な変更があるときは、本サービス上でお知らせします。</p>
      </LegalSection>

      <LegalSection heading="10. お問い合わせ">
        <p>運営者: KOBAE-LAB</p>
        <p>
          連絡先:{" "}
          <a href="mailto:kobae.lab@gmail.com" className="underline">
            kobae.lab@gmail.com
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
