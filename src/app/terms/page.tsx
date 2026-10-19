import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = { title: "利用規約 - Synclie" };

// 下書き: 運営者(KOBAE-LAB)が内容を確認してから公開すること。
export default function TermsPage() {
  return (
    <LegalPage title="利用規約" updatedAt="2026年10月20日">
      <p>
        この利用規約(以下「本規約」)は、KOBAE-LAB(以下「運営者」)が提供する学習支援サービス
        「Synclie - Boundless Learning System」(以下「本サービス」)の利用条件を定めるものです。
        本サービスを利用した時点で、本規約に同意したものとみなします。
      </p>

      <LegalSection heading="1. 本サービスについて">
        <p>
          本サービスは、教師が用意した教材をもとに、AI擬似メンバーと対話・討論しながら学ぶ
          ためのサービスです。AI擬似メンバーは人間ではなく、AIが生成した発言を行います。
        </p>
      </LegalSection>

      <LegalSection heading="2. アカウント">
        <ul className="list-disc space-y-1 pl-5">
          <li>教師のアカウントは、運営者の承認を受けた後に利用できます。</li>
          <li>学習者は、担当教師から伝えられた授業コードで参加を申請し、教師の承認を受けた授業に参加できます。</li>
          <li>アカウントとパスワードは、ご自身の責任で管理してください。他人に貸与・共有しないでください。</li>
          <li>運営者は、不正利用が疑われる場合、アカウントの停止・削除ができるものとします。</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. 禁止事項">
        <ul className="list-disc space-y-1 pl-5">
          <li>法令または公序良俗に反する行為、他人を傷つける・不快にさせる入力</li>
          <li>他人の個人情報・機密情報・著作権を侵害する内容の入力や教材のアップロード</li>
          <li>本サービスの運営を妨げる行為、不正アクセス、過度な負荷をかける行為</li>
          <li>授業コードや他人のアカウントを、権限なく利用する行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </ul>
      </LegalSection>

      <LegalSection heading="4. AIの出力についての注意">
        <ul className="list-disc space-y-1 pl-5">
          <li>AIの発言やフィードバックは、誤りや偏りを含むことがあります。内容は、ご自身で確かめてください。</li>
          <li>
            AIによる評価は、あくまで参考情報で、最終的な評価ではありません。評価の最終判断は、
            教師と学習者本人が行います。
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. 情報の取り扱い">
        <p>利用者の情報は、プライバシーポリシーに従って取り扱います。</p>
      </LegalSection>

      <LegalSection heading="6. 免責">
        <p>
          運営者は、本サービスの内容や、AIの出力の正確性・有用性を保証しません。本サービスの
          停止・中断・変更、データの消失などによって生じた損害について、運営者の故意または
          重過失による場合を除き、責任を負いません。
        </p>
      </LegalSection>

      <LegalSection heading="7. 変更・終了">
        <p>
          運営者は、本サービスの内容や本規約を、必要に応じて変更でき、サービスの全部または一部を
          終了できます。重要な変更は、本サービス上でお知らせします。
        </p>
      </LegalSection>

      <LegalSection heading="8. 準拠法・お問い合わせ">
        <p>本規約は日本法に準拠します。</p>
        <p>
          お問い合わせ:{" "}
          <a href="mailto:kobae.lab@gmail.com" className="underline">
            kobae.lab@gmail.com
          </a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
