@AGENTS.md

# Synclie - Boundless Learning System — 開発リファレンス (CLAUDE.md)

このファイルは、要件定義書(Claude Docs: 「非同期協働学習アプリ 企画・要件定義書」)の要点を
開発時に参照しやすい形でまとめたものです。詳細な議論の経緯や書きぶりは要件定義書本体を参照し、
このファイルは実装時の「早見表」として使ってください。

要件定義書URL: https://claude.ai/code/artifact/6ed10ac9-6621-41e4-99b9-f25ad7d9cc7f

## 1. コンセプト

- プロダクト名: **Synclie - Boundless Learning System**(略称 **Synclie**)。
  旧称は「Synclie - Interactive Ondemand Learning System」(2026-10-19に改称。GitHubリポジトリも
  `KOBAE-LAB/Synclie-Boundless_Learning_System`にリネーム済み)
- キーワード: オンデマンドを**インタラクティブに**、独習を**個別最適に**。
- 校種・職場を問わない**汎用性**が一次的な設計方針。離島など教育資源が制約された環境は、
  「最も厳しい環境で機能すれば、どこでも機能する」という位置づけのテストベッドであり、
  対象を離島に限定するものではない(この汎用性の優先順位を勝手に変えないこと)。
- 核となる仕組み: 教師がアップロードした教材をRAGで参照する「AI擬似メンバー(ペルソナ)」が、
  学習者と協働・討論することで、学習者に安易に同調せず思考を深めさせる。

## 2. ペルソナ設計(本研究の核)

擬似メンバーは5要素で構成される:
1. **プロフィール**(名前・役割・口調)
2. **知識源**(RAGで取得した教材の範囲。資料にないことは断定せず問い返す)
3. **立場と目標**(対立する立場を代表することもある。例: 「見取り」重視 vs エビデンス重視)
4. **行動ルール**(共通ガードレール: AI明示・資料限定・同調禁止・問い返し・発言量の制約)
5. **アバター(見た目)**(F25。プロフィール・立場の設定に応じてAIが画像候補プールから推薦する。
   都度の画像生成はしない。詳細はF25の項目を参照)

3つのペルソナ階層(tier):
- `teacher_defined`(教師設定型): 教師がプロフィール・立場を直接設定
- `rag_initial`(RAG初期型): 教材から初期状態を自動生成
- `evolved`(学習進化型): 過去の学習者データを反映して進化(初期バイアス増幅リスクに注意)

**同調禁止の原則**: ペルソナは、学習者の主張に「新しい根拠」または「具体的な事例」が
含まれる場合に限り、立場を譲歩してよい。それ以外は自分の立場を保つ。

## 3. 学習シナリオ

- **A**: グループワーク、初めての学習者
- **B**: グループワーク、後続の学習者(先行学習者の考えを投射したペルソナと対話)
- **C**: 初等中等教育の教科独習(「教わる側」「別の考えを持つ仲間」ペルソナ)
- **D**: 大学・企業等での討論学習(対立するペルソナとの議論、AIジャッジ評価)

## 4. 機能要件(F01–F26)の要点

詳細は要件定義書4章の表を参照。特に重要なもの:

- **F14 教師ダッシュボード**(必須): 学習状況の確認 + 指導計画に紐づく
- **F17 LMS連携**(将来/段階3): 既存のLMSと認証・成績・教材を連携する(LTI 1.3)。
  コード側は実装済みだが、実際のLMSへのツール登録(Canvas等の管理画面、人手が必要)は
  まだ行っていないため、実際のLMSとの連携は未検証。詳細は8章の`src/lib/lti/`の説明を参照
- **F18 多言語・アクセシビリティ**(将来/段階3): 多言語のUIと擬似メンバー、支援技術への対応。
  **アクセシビリティ部分のみ実装済み**(多言語UIは全ページが日本語ハードコードで、
  i18nフレームワーク導入+全ページ翻訳は別作業として保留)。フォーム項目に
  `<label>`(視覚的に隠す場合は`sr-only`)を付け、placeholderだけに頼っていた
  約10ファイルを修正した(スクリーンリーダー利用者向け、WCAG 3.3.2/4.1.2)。
  もともとクライアントJSフレームワークを使わずネイティブHTML要素だけで作っている
  設計のため、キーボード操作・フォーカスリング(`outline`を潰していない)は元から機能していた。
  画像(`<img>`)はアプリ内に無く、代替テキストの課題も無い
- **F19 独習モード**(段階2, GWが最優先でMVP、独習は2番目)。実装済み: `courses.mode`
  (`group`/`solo_study`)を教師が授業作成時に選ぶだけで、対話機構自体(F02〜F05)は
  そのまま使い回す。詳細は8章の`src/app/courses/`の説明を参照
- **F20 ペルソナ設計と同調の計測**: 「論証評価」ロジックでペルソナの意見変更を判定
- **F21 教員協働のペルソナ・教材ライブラリ共有**(必須/段階2): 同一組織はSSOで自動承認、
  組織を跨ぐ共有はアプリ側の承認者フローが別途必要(SSOだけでは判定できない)。
  実装済み。詳細は8章の`src/app/organization/`・`src/app/library/`の説明を参照
- **F22 SSO対応**(必須/段階2): Microsoft Entra ID / Google Workspace for Education。
  生徒のSSO subject idは、進級後もポートフォリオを引き継ぐための永続キーとして使う。
  低学年向けにはQRコード・絵柄パスワード等の代替ログイン手段が必要(要件定義書12章の未解決課題)。
  **Googleは本番(さくらVPS)で登録・実ログインまで確認済み**(2026-10-19、管理者アカウントが
  Googleに統合された)。**Microsoft Entra ID(長崎大)は未申請で、実ログインは未検証**
  (申請が済んだら`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET`/`_ISSUER`を本番の`.env.local`に設定する)。
  本番の設定値は`deploy/set-google-sso.sh`で書き込む(シークレットを画面・履歴・チャットに
  残さないため)。詳細は`src/auth.ts`・`src/lib/auth/sso.ts`の説明を参照
- **F23 生徒ダッシュボード**(必須/段階2): 学習状況確認 + 学習計画。実装済み。
  詳細は8章の`src/app/learn/dashboard/`の説明を参照
- **F24 討論のAIジャッジ・評価**(必須/段階2): 論理構成/根拠の質/反論への応答で評価。
  **非最終**の評価であり、学習者の自己評価・教師評価の材料にとどめる
  (「AIが学習者の考えを代替しない。評価の最終判断は教師と学習者に残す」)。
  実装済み。詳細は5章「論証評価」共有コンポーネントを参照
- **F25 ペルソナのアバター推薦**(推奨/段階3): ペルソナに見た目(アバター)を持たせ、
  学習者が「顔の見える」相手と対話している臨場感を持てるようにする。教師が固定の画像を選ぶのではなく、
  プロフィール・立場と目標の設定内容に応じてAIが画像候補プール(あらかじめ用意した複数の画像)の中から
  最も合う候補を推薦する方式(都度の画像生成はコストが重いため行わない)。推薦は手動選択でいつでも
  上書きでき、教師が最終的に採用・変更できるようにしている(AIが一方的に見た目を固定しない)。
  実装済み。詳細は8章の`src/lib/ai/persona-avatar.ts`の説明を参照
- **F26 横断的な学びの記録とAIフィードバック**(推奨/段階2): F09(学習者プロファイル)・
  F11(個別最適化支援)は授業ごとに生成するが、SSO(F22)の永続IDで学習者を跨授業・跨年度で
  追跡できることを活かし、学習者本人が関わった**全ての授業を横断**して振り返り、
  自律的に学びを調整できるようにする。F11と違い教師の採用は挟まず、学習者本人にそのまま
  提示する提案である点が異なるため、別テーブル(`learner_profiles`/`learner_suggestions`)・
  別AIモジュール(`src/lib/ai/learner-suggestions.ts`)にしている(促し方・難度調整の観点を
  「ペルソナへの指示」ではなく「学習者自身の行動」に読み替えたプロンプトにしてある)。
  自動生成はせず、生徒ダッシュボード(F23)で学習者本人が明示的に押したときだけ生成する。
  実装済み。詳細は8章の`src/app/learn/dashboard/`の説明を参照。学校・組織をまたいで
  集約する場合の外部連携は12章の未決事項(要検討)

## 5. 「論証評価」共有コンポーネント

F20(ペルソナの意見変更判定)とF24(討論AIジャッジ)は、**同じ論証評価ロジックを共有する**。
設計の一貫性とコスト削減(呼び出し回数削減)の両方が理由。
実装: `src/lib/ai/argument-evaluation.ts`

F20はF05(擬似メンバー対話)の`sendMessageAction`に組み込み済み。学習者の発言のたびに
`evaluateArgument()`で「新しい根拠・具体例を含むか」を判定し、その結果を
`src/lib/ai/persona.ts`の`PersonaProfile.turnGuidance`としてペルソナのプロンプトに渡す
(根拠が無ければ「この発言だけを理由に立場を変えないこと」と明示的に指示する)。
ペルソナの返答自体も構造化出力にしてあり(`askPersona`が`{reply, conceded}`を返す)、
「譲歩したか」を同じ呼び出しの中で自己申告させる。`hasNewEvidence`と`conceded`を
突き合わせて`unwarranted_conformity`(根拠なく同調したか)を`argument_evaluations`に記録し、
`courses/[courseId]/conformity/`でペルソナ別に集計・一覧できる(ペルソナの設定を変えて
比較するための画面)。評価呼び出しが失敗しても対話自体は止めない(計測は付加情報のため)。

F24は`argument-evaluation.ts`の`judgeDiscussion()`(`evaluateArgument()`と同じ
`ArgumentEvaluationSchema`・同じモデルを使うが、プロンプトが「直近の発言」ではなく
「議論全体を通して」ジャッジする内容になっている別関数)を使う。F06(成果の提出)を
議論が一区切りついたタイミングとみなし、`learn/[courseId]/actions.ts`の
`judgeDiscussionAction`が、その提出物につながる対話セッション全体の`dialogue_turns`を
書き起こして渡し、結果を`discussion_judgments`(1提出物1件、再ジャッジで上書き)に保存する。
学習者向け(`learn/[courseId]/page.tsx`)・教師向け(`courses/[courseId]/submissions/`)の
両方に表示され、「この評価は最終ではない」という注記を必ず添える
(非機能要件「AIが学習者の考えを代替しない。評価の最終判断は教師と学習者に残す」)。

## 6. 教材データの方針

- 教科書本文そのものは保存しない。教師が入力した資料 + 学習指導要領/使用教科書との
  対応表(カリキュラムマッピング)をベースに、現行LLMで出題・フィードバックを生成する。
- 教材データはRAG(pgvectorによるベクトル検索)で参照する。

## 7. 技術スタック(段階1)

- **配色・ロゴ**: 姉妹アプリ「Synclie - Share」(同じKOBAE-LABブランド)に合わせてある。
  `src/app/globals.css`の`@theme`ブロック(canvas/surface/ink/accent/danger/success/warn等の
  トークン)は`synclie-share`の`src/app/globals.css`と値を揃えているので、**配色を変える時は
  両方のアプリで揃えて直すこと**。黒基調のダークテーマを既定にしている(教室のプロジェクタでは
  明るい地だと周りが見えにくくなるため。ライト/ダーク自動切替はやめ、単一テーマにした)。
  ロゴ(`public/logo.png`・`src/app/icon.png`、KOBAE-LABのマスコット)は
  `src/app/layout.tsx`のヘッダーと`src/app/login/page.tsx`に配置している
- **フロントエンド/バックエンド**: Next.js (TypeScript, App Router)。API RoutesとServer Actionsを併用。
- **DB/ベクトル検索/ストレージ**: Supabase (Postgres + pgvector)。プロジェクトは東京リージョン
  (ap-northeast-1)、組織KOBAE-LAB。2026-09-25に元プロジェクト(ap-southeast-2)から
  移行した(旧プロジェクトは「【KOBAE-LAB】Synclie - IIL (旧)」にリネームして保持)。
  `supabase/config.toml`があるためSupabase CLIでの操作(`supabase link` /
  `supabase db push` / `supabase db advisors`など)が使える。テーブル・Storageの
  一括移行に使った`scripts/migrate-supabase.mjs`(export/importモード)は、
  将来また別プロジェクトへ移す場合の参考として残してある
- **認証**: Auth.js (NextAuth v5)。段階1は簡易ログイン → 段階2でSSO(F22)。
  `src/auth.ts` にプロバイダーを追加していく。
- **ホスティング**: 当面(暫定)は**さくらVPS**(アプリ) + Supabase(データ)。Vercelは使わない。
  公開URLは https://synclie-boundless-learning-system.kobae-lab.com/ 。同じVPSで他のアプリ
  (`synclie-share`:3006、`tech-integration`:3005)が動いており、メモリも1GBしかないため、
  **ビルドはVPS上でなく手元で行う**(`deploy/deploy.sh`)。手順と注意点はREADME.mdの
  「さくらVPSへのデプロイ」を参照。Supabaseは開発用と本番用に分けてある点にも注意(下記「認証まわりの注意」とREADME参照)。
  将来Vercel等へ移す可能性は残すが、現時点でVercel固有の設定・機能には依存させないこと
- **LLM**: OpenAI(Responses API)。マルチモーダル対応・構造化出力の成熟度・コストを理由に選定
  (Anthropic/Googleとの比較検討の結果)。モデル名は変わりやすいため、
  `src/lib/ai/openai.ts` の `MODEL_PERSONA` / `MODEL_JUDGE` / `MODEL_EMBEDDING`(F02の埋め込み用)
  を環境変数で上書き可能にしてある。同ファイルの `openai` エクスポートは Proxy 越しの遅延初期化に
  しており、`OPENAI_API_KEY` 未設定でも `next build` 自体は通る(実際に呼び出した瞬間にエラーになる)。
  - **注意**: OpenAIのAPI/SDKは更新が速い。`responses.create` / `responses.parse` / `embeddings.create`
    まわりでエラーが出たら、その時点の公式ドキュメント(platform.openai.com/docs)を確認し、書き換えること。

## 8. リポジトリ構成

- `src/app/layout.tsx` — ルートレイアウト。ログイン中のみ、ロールに応じたホームへの
  リンク(教師→`/courses`、学習者→`/learn`)とログアウトボタンを出す共通ヘッダーを表示する
  (`src/app/logout-action.ts`の`logoutAction`が`signOut()`を呼ぶ)。UIレビューで
  「アプリ内にログアウト手段が無く、NextAuth既定の`/api/auth/signout`を直接開くしかない」
  という指摘が出たため追加した。アプリ全体でここにしかナビゲーションは無いので、
  新しい画面を追加する時もここに依存しない導線(戻るリンク等)を各ページ側に用意すること
- `src/components/submit-button.tsx` — `SubmitButton`。AI呼び出しなど数秒かかる
  サーバーアクションの送信ボタンをラップし、送信中は無効化してラベルを
  (例:「生成中…」)に差し替える(`useFormStatus`を使うため`"use client"`が必要な
  唯一の理由。フォーム自体はサーバーアクションのまま)。UIレビューで「処理中の見た目の
  変化が無く、二重送信の恐れがある」という指摘が出たため、RAG生成・メッセージ送信・
  手書き/音声の確認送信・AIフィードバック/AIジャッジ/学習者プロファイル/個別最適化提案/
  アバター推薦/LMS成績送信/共有ライブラリの複製など、AI呼び出しやネットワーク呼び出しを
  伴うボタンに適用した(即時完了する承認・削除・共有トグルなどには適用していない)
- `src/components/thinking-indicator.tsx` — `ThinkingIndicator`。発言送信フォームの中に
  置き、擬似メンバーの応答が返るまでの間「(相手が)考えています」+点滅ドットを表示する
  (`SubmitButton`と同じ理由で`"use client"`)。「臨場感・社会的存在感を大事にしたい。
  Zoom/Teamsのようなビデオ会議のイメージで」という要望を受けて追加した。
  `learn/[courseId]/page.tsx`の対話相手表示は、ビデオ会議アプリの「映像タイル」を模し、
  名前ラベル(左下)・発言中バッジ(右上、直近に発言した擬似メンバーだけ緑の縁取りと
  あわせて表示)を重ねている。1人なら大きな1枚のタイル、複数人なら`grid-cols-2`の
  ギャラリービューにし、まるで同期オンライン学習をしているような臨場感を出す。
  タイルの下には、ビデオ会議のライブキャプション欄を模して直近の発言をテキストでも表示する。
  **アバターの絵作りは「背景」と「人物」を別々の画像ファイルとして持ち、表示側
  (`learn/[courseId]/page.tsx`の`backgroundFor()`)で重ねて合成する方式**にしている。
  当初はコードで組み立てる自作SVG(後にDiceBear/Avataaarsに置き換え)を使っていたが、
  「センスが無い」「臨場感が持てない」という指摘を受け、**最終的にコード生成をやめ、
  ユーザー本人が外部のAI画像生成サービスで用意したイラストに全面差し替えた**
  (F25の「都度の画像生成はしない」方針は変わらない。都度生成ではなく、
  あらかじめ用意した画像プールを使う点は同じ)。
  - 人物: `public/avatars/*.png`(16人分、背景透過)。ユーザーがAI画像生成サービスで
    複数人物×3表情(笑顔/驚き/真剣)のシート画像を作り、1コマずつ切り出したもの
    (206×150px程度と解像度は高くないが、フラットなアニメ塗りのため拡大してもさほど
    破綻しない)。ファイル名・`avatar_options`テーブルのスキーマ・行(id/label/tags)は
    変更していない(`0026_avatar_illustrations.sql`で`file_path`の拡張子を
    `.svg`→`.png`に更新しただけ)。F25の推薦ロジックはラベル・タグに基づくため影響なし。
    新しい候補を増やしたい場合は、同じAIサービスで追加のシートを作って切り出し、
    `public/avatars/`に置いた上で`avatar_options`に1行追加する(自動生成スクリプトは
    廃止したので手作業)。
  - 背景: `public/avatars/backgrounds/*.jpg`(教室・大学の講義室・オフィス・会議室の
    実写ふうの写真、5種類)。DBには持たず、`backgroundFor(avatarPath)`が人物画像の
    ファイル名(テンプレートID)から`AVATAR_BACKGROUNDS`(同ファイル内の定数)で
    雰囲気の合う部屋を決定的に選ぶ(例: 小学生→`elementary-classroom`、
    中学生→`jhs-classroom`、大人の論理派→`office`など)。人物画像は透過なので、
    この背景の上に重ねるだけで自然に合成される。
  - どちらのタイルも正方形(`aspect-square`)で、`object-fit: cover`を使うため、
    横長の人物画像・背景写真でもタイルいっぱいに敷き詰められる。
  あわせてアバター用の控えめなアイドルアニメーション(`.avatar-idle`、静止画+CSSのみ)も
  入れている。どちらも`prefers-reduced-motion`を尊重して無効化する
- `deploy/` — さくらVPS用の更新スクリプト(`deploy.sh`、手元で実行)・初期設定(`setup-vps.sh`)・
  systemdユニット。詳細はREADME.mdの「さくらVPSへのデプロイ」。アップロード上限は
  `next.config.ts`の`serverActions.bodySizeLimit`とnginxの`client_max_body_size`で揃える
- `src/app/` — Next.js App Router のページ・APIルート
  - `src/app/page.tsx` — ログイン後の行き先をロールで振り分ける(教師→`/courses`、
    学習者→`/learn`)。`login/actions.ts`の`loginAction`は`redirectTo: "/"`固定にしてあり、
    ロールごとの分岐はここに集約している
  - `src/app/login/` — 段階1の簡易ログイン画面(メール+パスワード、`login-form.tsx`)。
    F22用に、対応する環境変数(`AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_GOOGLE_ID`)が
    設定されている時だけ「Microsoftでログイン」「Googleでログイン」ボタンを
    `page.tsx`(サーバーコンポーネント)が条件付きで表示する
  - `src/app/signup/` — 自己登録(サインアップ)。「誰でも自由に登録できるとAI呼び出しの課金が
    読めない」ため、承認制にしている。学習者(`signup/student/`)は教師が伝える**授業コード**
    が必須で、登録しても`course_enrollments.status='pending'`の申請になり、教師が承認する
    まで授業に入れずAIも呼べない。教師(`signup/teacher/`)は`profiles.approval_status='pending'`で
    作られ、**管理者が承認するまでログインできない**(`src/auth.ts`の`authorize`が
    `PendingApprovalError`/`RejectedError`を投げ、`login/actions.ts`が理由を表示する)。
    エラーはURLの`?error=`で返し、入力内容はURLに載せない。入力チェックは
    `src/lib/auth/signup-validation.ts`(パスワードは10文字以上。テストあり)
  - `src/app/admin/teachers/` — 教師の自己登録の承認(`requireAdmin()`、管理者のみ)。管理者は
    別ロールではなく教師アカウントに付く属性(`profiles.is_admin`)。最初の管理者は
    `scripts/dev/create-user.mjs --role teacher --admin true`で作る。教師の授業一覧
    (`courses/page.tsx`)に、管理者にだけ承認待ち件数つきのリンクを出す
  - `src/app/account/password/` — ログイン中の本人がパスワードを変える(現在のパスワードが必須)。
    教師が直接登録した学習者の初期パスワードを本人に変えてもらうために置いた。
    ヘッダー(`layout.tsx`)に常にリンクがある。SSO/LTIのアカウントはパスワードを持たないため変更不可
  - `src/app/consent/` — F16(同意・データ管理)。学習者が同意していない/撤回済みの場合、
    `src/lib/consent.ts`の`requireConsent()`がここへリダイレクトする
    (`/learn`, `/learn/[courseId]`, `/learn/[courseId]/portfolio`から呼んでいる)。
    同意すると`consent_records`に記録され`/learn`に戻る
  - `src/app/learn/data/` — F16用。学習者が自分の同意状況の確認・撤回(利用停止)、
    保存データ件数の確認、全データ削除(`deleteMyDataAction`。ログインアカウント自体は
    残す)ができる。同意状況に関わらずアクセスできる(撤回中でもここは使える)。
    学習者に紐づくテーブルを追加するたびに、ここも合わせて更新すること(F12実装時に
    手書き画像のStorageファイル削除と、抜けていたF11の`personalization_suggestions`削除を
    追加で拾った。F13実装時に音声ファイルの削除も同様に追加した。F23実装時に
    `study_plan_items`削除も追加した。F24実装時に`discussion_judgments`削除も追加した。
    F26実装時に`learner_profiles`/`learner_suggestions`削除も追加した)
  - `src/app/learn/dashboard/` — F23(生徒ダッシュボード)。「学習者が自分の学習履歴
    (対話ログ、成果物、フィードバック、振り返り)を一覧で確認し、AIの提案をもとに次に
    取り組む学習計画を立てられる」(要件定義書4章)。F14(教師ダッシュボード)と同じ方針で、
    新規のAI呼び出しはせず既存データを集計するだけの画面: 学習者が所属する全授業
    (`learning_sessions`基準)の発言数・提出数・最終活動日時、F11で採用済みの探究テーマ
    提案、F08の振り返りの「次にやりたいこと」を横断的に一覧表示する。「学習計画を立てられる」
    の部分だけは既存データで表現できないため、学習者が自分で追加・完了・削除できる
    簡単なTODOリスト(`study_plan_items`、授業を指定してもしなくてもよい)を新設した。
    同じ画面にF26(横断的な学びの記録とAIフィードバック)がある。F23自体は「新規のAI呼び出しを
    しない」画面だが、F26はその方針の中で唯一の例外として、学習者本人が明示的に押したときだけ
    AIを呼ぶ(`actions.ts`の`generateLearnerProfileAction`/`generateLearnerSuggestionsAction`)。
    `courses/[courseId]/students/actions.ts`の`buildActivityLog`(F09、授業単位)と同じ形の
    `buildCrossCourseActivityLog`を使うが、`course_id`で絞らず学習者の全提出物を束ねる点が違う。
    生成結果は`learner_profiles`/`learner_suggestions`(courseに紐づかない、学習者1人1行)に保存する
  - `src/app/learn/` — F05(擬似メンバー対話)。学習者向け。`page.tsx`は
    **受講登録(course_enrollments)している授業だけ**を一覧表示する。「教師が開設した
    授業コードと学習者をつなげる仕組みが無い」(段階1は全授業を無条件表示していた)という
    指摘を受けて追加した。教師は`courses/[courseId]/page.tsx`の「受講登録」欄で
    授業コード(`courses.join_code`。新規作成時に自動生成、`0028_course_enrollments.sql`の
    列デフォルト式)を確認・再発行でき、参加している学習者の一覧から個別に参加登録を
    外すこともできる。学習者は`learn/join/`でコードを入力して**参加を申請**する
    (`joinCourseByCodeAction`。`status='pending'`の申請になり、教師が`courses/[courseId]/page.tsx`の
    「承認待ち」で承認(`approveEnrollmentAction`)して初めて授業に入れる。コードは大文字小文字・空白を無視)。
    教師は学習者を直接登録することもできる(`registerStudentAction`。アカウントが無ければ教師が決めた
    初期パスワードで作り、承認の手間なしにその場で`approved`になる)。アクセス制御は
    `src/lib/courses/enrollment.ts`の`requireEnrollment()`(ページ側、未登録なら
    `/learn?not_enrolled=1`へリダイレクト。`assertOwnsCourse()`と対になる生徒側のガード)と
    `isEnrolled()`(承認済み`status='approved'`だけを参加扱いにする。`actions.ts`の`getOrCreateSession()`内、サーバーアクションを
    ページ経由せず直接叩かれた場合の防御)の二重チェックにしている。F17(LTI)経由の
    起動は、プラットフォーム側が履修者であることを既に保証しているとみなし、
    未登録でもエラーにせず自動的に参加登録(承認済み)する。この機能を入れる前から対話していた
    学習者(`learning_sessions`に既存行がある)は、マイグレーションで自動的に
    参加登録済み扱いにしてある(締め出さないため)。`[courseId]/page.tsx`が実際のチャット画面。
    学習者ごとに1つの進行中セッション(`learning_sessions`, `ended_at is null`)を
    get-or-createし、発言のたびに`actions.ts`の`sendMessageAction`が
    (1)学習者発言を保存 → (2)F04で`active`にした擬似メンバーの中から1体選ぶ
    (`pickRespondingPersona`。複数体いる場合、(a)学習者の発言で名指しされたペルソナが
    いればそれを優先し、(b)無くても直前の擬似メンバーの発言が別のペルソナを名指し
    (反論・言及)していればその名指しされた本人を優先し、(c)どちらも無ければ発言が
    少ないペルソナの中からランダムに選ぶ(`isPersonaMentioned`、正式名の末尾一致で
    「山田くん」のような略した呼び方にも対応)。「発言が少ない順に機械的に選ぶと、
    複数人いる時に順番に発言しているような不自然さがある」「名指しで反論しても、
    名指しされた本人ではなく別の未発言のメンバーが割り込んでしまう」という指摘を
    受けて、(a)(b)の優先順位を追加した) →
    (3)`src/lib/rag/search.ts`で授業RAG(F02の`material_chunks`)から関連チャンクを検索 →
    (4)`src/lib/ai/persona.ts`の`askPersona`で発言を生成 → (5)保存、の順で処理する。
    複数のペルソナがいる授業では、擬似メンバーの発言は全て`dialogue_turns`上
    `speaker_type='persona'`という同じ扱いになるため、LLMに渡す会話履歴でも
    他のペルソナの発言が自分の発言と区別できず、「反論が機能しない」という指摘が出た
    (他のペルソナの発言をrole:"assistant"としてそのまま渡すと、モデルからは
    自分自身の過去の発言に見えてしまうため)。対策として、履歴内の擬似メンバーの発言には
    話者名を先頭に付け(`まだ分からないコウタくん: ...`)、`askPersona`に渡す
    `PersonaProfile.otherParticipants`で他の使用中ペルソナの名前・立場も伝えるようにした
    (`persona.ts`の`buildPersonaSystemPrompt`と`COMMON_GUARDRAILS`に、学習者だけでなく
    他の擬似メンバーの発言にも根拠なく同調しない旨を追記)。
    **「テンポ」設定(沈黙時の自動継続)**: 「自分の発言を待たずにAI同士が語るのも自然」
    という要望を受け、学習者がしばらく発言しない時、擬似メンバー同士で会話を自動的に
    続けられるようにした。ただし「無制限だと授業時間を消費してコストも際限なくなる」
    という懸念があったため、(1)学習者の発言をまたがずに連続で自動継続できる回数を
    `AUTO_CONTINUE_CAP`(`src/lib/discussion-tempo.ts`、既定2回)で打ち切り、
    (2)裏で動くcron/ポーリングは作らず、学習画面が開いている間だけ動くクライアント側の
    沈黙タイマー(`src/components/auto-discussion-timer.tsx`の`AutoDiscussionTimer`、
    `useEffect`+`setTimeout`。SubmitButton/ThinkingIndicatorに次ぐ3つ目の
    `"use client"`理由で、この機能だけは「学習者が何も操作しないこと」自体を検知する
    必要があるため)で完結させている。「テンポ」(沈黙してから自動継続するまでの秒数、
    `TEMPO_OPTIONS`)は教師が`courses/[courseId]/page.tsx`で既定値を設定し
    (`courses.auto_discussion_tempo_seconds`、0/未設定=オフ)、学習者は自分の
    授業画面(`learn/[courseId]/page.tsx`の`<details>`)でその既定値を自分用に
    上書きできる(`learning_sessions.auto_discussion_tempo_seconds`)。「この設定を
    評価の参考にするか」(`courses.auto_discussion_affects_evaluation`)は教師だけが
    決められ、学習者側には表示のみ(変更不可)。自動継続で生成された発言は
    `dialogue_turns.auto_generated=true`で区別し、対話ログ・キャプション欄の両方に
    「(自動継続)」と表示して、後から教師が振り返る時に見分けられるようにしている
    (`autoContinueDiscussionAction`。新しい学習者発言が無いため、F20の論証評価
    (`evaluateArgument`)は呼ばない。資料検索は直近の学習者発言を手がかりに行う)。
    同じページの下段にF06(テキスト入力)の「成果を提出する」フォームがある
    (`submitOutcomeAction`)。`dialogue_turns`(逐次のやり取り)とは別に、議論を経て
    まとめた「成果」を`submissions`テーブルに保存する。各提出物には「フィードバックをもらう」
    ボタンがあり(`generateFeedbackAction`、F07)、教師が`criteria/`で設定した観点ごとに
    良い点・次に考える問い・参照すべき資料の箇所を生成し`submission_feedback`に保存する。
    フィードバック生成後(`feedback_status='done'`)は振り返りフォーム(F08、
    `saveReflectionAction`)が現れる: 学んだこと・迷ったこと・次にやりたいことを
    `reflections`に保存し(1提出物1件、`submission_id`にunique制約)、
    「教師に共有する」チェックボックス(`shared_with_teacher`)で公開範囲を選べる。
    `[courseId]/portfolio/` は成果・フィードバック・振り返りを時系列にまとめた読み取り専用ビュー。
    同じチャット画面にF12(手書き入力)の画像アップロードフォームがある(テキスト入力とは別枠)。
    「内部では『テキスト化した内容+元データ』の組に統一し、同じ仕組みで扱う」(要件定義書8章)ため、
    テキスト発言・手書き発言のどちらも最終的には同じ`dialogue_turns`行になる(区別は
    `source_kind`列)。テキスト発言は`sendMessageAction`が直接処理するのに対し、手書きは
    「認識してから、本人が確認・修正してから送信できる」(要件定義書8章)ことが必須要件なので、
    確定前に`handwriting_uploads`という一時テーブルを経由する2段階フローにした:
    (1)`uploadHandwritingAction`が画像をStorageバケット`handwriting`に保存し、
    `src/lib/ai/handwriting.ts`の`recognizeHandwriting`(画像を渡すマルチモーダル呼び出し)で
    テキスト化して`handwriting_uploads.status='ready'`+`recognized_text`に保存する(失敗時は
    `status='failed'`+`error`)。(2)画面には認識結果が編集可能なテキストエリアとして表示され、
    学習者が内容を確認・修正してから「この内容で送信」を押すと`confirmHandwritingAction`が
    (編集後の内容で)テキスト発言と共通の`postStudentMessageAndRespond`ヘルパーを呼び、
    `source_kind='handwriting'`+`image_path`付きで`dialogue_turns`に保存する(以降はF05/F11/F20と
    完全に同じ経路でペルソナが応答する)。「取り消す」を押すと`discardHandwritingAction`が
    Storage上の画像ごと削除する。テキスト発言側のロジックも`postStudentMessageAndRespond`に
    切り出し、`sendMessageAction`(テキスト)と`confirmHandwritingAction`(手書き)の両方から
    共用している。
    F13(音声入力)もまったく同じ2段階フローを`audio_uploads`テーブルで実装している:
    `uploadAudioAction`が音声ファイルをStorageバケット`audio`に保存し、
    `src/lib/ai/audio.ts`の`transcribeAudio`(OpenAIの音声文字起こしAPI)でテキスト化、
    `confirmAudioAction`が確認・修正後のテキストを`postStudentMessageAndRespond`
    (`source_kind='audio'`)に渡す、`discardAudioAction`が取り消す。F12実装時は
    `dialogue_turns.image_path`という手書き専用の列名だったが、F13で音声にも同じ列を
    使うため`source_path`に改名した(`postStudentMessageAndRespond`の引数も
    `imagePath`→`sourcePath`)
    ペルソナの発言(`speaker_type='persona'`)には、そのペルソナに`avatar_id`が設定されて
    いればアバター画像(F25)を小さく添えて表示する(`personas`→`avatar_options`と
    2段階で`file_path`を引く。未設定のペルソナは画像なしのまま、名前だけ表示する)
  - `src/app/courses/` — F01(授業・資料の登録)。教師が授業を作成する時、
    `mode`(`group`=グループワーク/`solo_study`=独習、F19)も選ぶ
    (`courses.mode`、既定は`group`)。`[courseId]/` で資料
    (PDF/Word/PPT/テキスト/動画字幕/URL)をアップロードする。
    同じ画面にF02(RAG生成)の「生成する/再生成」ボタンとステータス表示もある
    (`actions.ts` の `generateMaterialRagAction` / `generateAllPendingRagAction`)。
    F19(独習モード)は新しい対話機構を作らず、既存のF02〜F05をそのまま使い回す設計:
    授業(=シナリオCの「単元」に相当する粒度)が`solo_study`なら、
    `learn/[courseId]/actions.ts`の`getOrCreateSession`が作るセッションも
    `learning_sessions.mode='solo_study'`になり、`learn/[courseId]/page.tsx`の
    説明文が「まだ分かっていない擬似メンバーに、自分の言葉で説明してみよう」に変わる。
    ペルソナを「まだ分からない仲間」役として設定する(F03/F04)のも、説明の質への
    フィードバックをF07の観点(例: 根拠の明確さ・用語の正しさ・誤りの有無)で行うのも、
    どちらも既存の仕組みをそのまま使う運用上の使い分けであり、コード上の分岐は無い
    - `[courseId]/dashboard/` — F14(教師ダッシュボード)。「参加状況、つまずき、
      擬似メンバーの挙動を確認し、学級・個人の指導計画に活かす」(要件定義書4章)。
      新規のAI呼び出しは一切せず、既存の蓄積データ(dialogue_turns/submissions/
      argument_evaluations/student_profiles)を集計するだけの読み取り専用画面
      (呼び出し回数を増やさない方針、要件定義書10章)。学習者一覧は
      `learning_sessions`基準(students/の「提出物がある学習者」より広く、
      対話はしたが未提出の学習者も拾う)。学習者ごとに発言数・提出数・最終活動日時・
      論証評価(F20/F24共有コンポーネント)の平均点・(生成済みなら)F09の「課題」を表示し、
      平均点が低い、または対話はあるが未提出の学習者を「つまずき」としてハイライトする。
      擬似メンバーの挙動はF20と同じデータをペルソナ単位に集計して要約表示する。
      「状況を確認するだけで終わらせず、次に何に取り組むかをその場で決められる形にする」
      (要件定義書7章)ため、各行から`students/#{studentId}`(F09/F11の判断)や
      `conformity/`(F20の詳細)へ直接リンクする(students/の各`<li>`に
      `id={studentId}`を付与し、アンカーで深リンクできるようにした)
    - `[courseId]/personas/` — F03(ペルソナ設定)+F04(教師による擬似メンバー設定)。
      段階1では教師設定型(`tier='teacher_defined'`)のみを教師が作成・編集・削除する。
      プロフィール/立場と目標/行動ルールを入力するフォームは`persona-form.tsx`を作成・編集で共用。
      知識源(授業RAG)は`course_id`で暗黙に決まるため入力フォームには含めない。
      F04は`personas.status`(`draft`→`approved`→`active`)の承認ワークフローとして実装:
      draftのまま対話に使われないよう、教師が明示的に承認(`approved`)し、
      その授業で実際に使うペルソナだけを`active`にする(「人数」の管理はactiveの数で表現する)。
      同じ画面にF10(学習進化型擬似メンバー)の「学習進化型ペルソナを生成する」ボタンがある
      (`generateEvolvedPersonasAction`)。同意済み(`consent_records.withdrawn_at is null`)の
      学習者の発言・成果・振り返りだけを集め(氏名は含めない)、`src/lib/ai/evolved-persona.ts`の
      1回の呼び出しで(1)論点・誤概念・有効な問いを抽出して`learner_corpus_entries`に保存、
      (2)3〜5個の役割プロファイルを`tier='evolved', status='draft'`のpersonaとして作成する。
      「人数が少ない間は投射を控える」(要件定義書5章)ため、同意済み学習者が
      `MIN_STUDENTS_FOR_EVOLVED`(3人)未満だと生成を拒否する。生成後は既存のF04承認
      フローにそのまま乗る(教師がここで確認・編集してから承認・有効化する)。
      `personas.origin_note`に生成理由を保存し、一覧に表示する。
      同じ画面に各ペルソナのアバター(F25)表示・「AIに推薦させる」ボタン
      (`recommendPersonaAvatarAction`)・手動選択のプルダウン(`setPersonaAvatarAction`、
      AIの推薦をいつでも上書きできる)がある。候補プールは全授業共通の`avatar_options`
      テーブル(`0024_persona_avatars.sql`でシード済み、画像本体は`public/avatars/`の
      PNG。ユーザーがAI画像生成サービスで用意したイラストで、`0026_avatar_illustrations.sql`
      で`file_path`を差し替えた。詳細は8章の`thinking-indicator.tsx`の説明を参照)。
      推薦・変更の結果は`personas.avatar_id`/`avatar_status`/`avatar_error`に保存する
      (F02/F07などと同じ status/error 列のパターン)
    - `[courseId]/criteria/` — F07用。評価の観点(例: 根拠の明確さ)を教師が作成・編集・削除する。
      観点が1つも無いと学習者はAIフィードバックを受け取れない
    - `[courseId]/submissions/` — F07用。教師が全学習者の提出物(F06)とAIフィードバックを
      一覧で確認し、`updateFeedbackAction`でフィードバックの文面(良い点/次に考える問い/
      参照すべき資料の箇所)を修正できる(要件定義書7章「教師は…確認、修正できる」)。
      F08の振り返りのうち`shared_with_teacher=true`のものだけをクエリ時点で絞り込んで
      あわせて表示する(共有していない振り返りはこのクエリに含めない。UI側で隠すのではなく
      サーバー側で境界を作る)
    - `[courseId]/students/` — F09(学習データ蓄積のうち学習者プロファイル)+F11(個別最適化支援)。
      この授業で提出物がある学習者ごとに、蓄積した成果・フィードバック・振り返り(F06〜F08)を
      1本のテキストに束ねて`src/lib/ai/student-profile.ts`に渡し、得意な点・課題・
      学習履歴の要約を生成する(`generateStudentProfileAction`、`student_profiles`に保存)。
      自動生成はせず、呼び出し回数を絞るため教師が明示的に押したときだけ生成する。
      F09のプロファイルが生成済み(`status='done'`)であれば、続けて「提案を生成する」で
      F11の4種類の提案(同じ誤解を避ける問い/探究テーマ/促し方の調整/難度・足場かけの調整、
      `src/lib/ai/personalization.ts`)を生成できる(`personalization_suggestions`に保存)。
      「AIが学習内容や評価を一方的に固定しない」(要件定義書7章)ため、教師が「採用する」を
      押すまで対話には反映されない(`status`: suggested→accepted/declined)。採用後は
      `src/app/learn/[courseId]/actions.ts`の`sendMessageAction`が、促し方・難度・誤解回避の
      問いをそのペルソナのturnGuidanceに追加し、探究テーマの提案は学習者の対話画面にも表示する
    - `[courseId]/conformity/` — F20用。ペルソナ別の「根拠なく同調した割合」
      (`unwarranted_conformity`)を集計し、フラグが立った発言を一覧表示する読み取り専用画面
      (詳細は5章「論証評価」共有コンポーネント参照)
    - `[courseId]/audit/` — F15(挙動の監査と修正)。「擬似メンバーの発言ログを確認し、
      不適切・不正確な挙動を修正する」(要件定義書4章)。この授業の擬似メンバーの発言
      (`dialogue_turns`, `speaker_type='persona'`)を、直前の学習者発言(文脈)とあわせて
      一覧表示し、`updateTurnAction`で内容を直接修正できる(F07の`updateFeedbackAction`と
      同じ「新しい監査テーブルは作らず、対象の行に直接書き込む」方針。`dialogue_turns`に
      `flagged_by_teacher`・`teacher_note`を追加)。修正後の内容は以後の対話でLLMに渡す
      直近履歴としてもそのまま使われるため、訂正すれば同じ誤りの再発も防げる
  - `src/app/organization/` — F21用。組織(学校・地域単位)への参加・作成と、組織をまたぐ
    共有リクエストの承認者設定。SSO(F22)がまだ無いため、`profiles.organization_id`への
    所属は教師が組織名を入力して自己申告で参加・作成する方式にしている
    (`joinOrCreateOrganizationAction`: 同名の組織があれば参加、無ければ新規作成して
    自分がその組織の承認者になる)。「承認者の指定方法」は要件定義書12章で「未解決」と
    明記されている論点。単一の管理者ロールがまだ無いため、「組織に所属する教師なら誰でも、
    その組織の承認者を指定・変更できる」という最小限の自己統治ルールを暫定採用した
    (`setApproverAction`)。組織の承認者は、この画面で組織をまたぐ共有リクエスト
    (`share_requests`)を承認/見送りできる(`decideShareRequestAction`)
  - `src/app/library/` — F21用。共有ライブラリ。「教員(授業者)が、単元の対応表や
    擬似メンバー設定を学校・地域をまたいで複製・共有し、互いの実践を参照しながら教材と
    ペルソナを育てられるようにする」(要件定義書4章)。`personas.shared_at` /
    `course_materials.shared_at`(kind='syllabus'のみ共有可)が立っているアイテムを一覧表示し、
    公開元の教師の組織が自分と同じなら即時複製(`duplicatePersonaAction` /
    `duplicateMaterialAction`)、違えば`requestCrossOrgAccessAction`でリクエストを送り、
    相手組織の承認者が`/organization`で承認してから複製できるようになる
    (`share_requests.status`: pending→approved/declined)。ペルソナの共有は
    `courses/[courseId]/personas/`(承認済み以上のみ共有可、下書きは不可)、教材の共有は
    `courses/[courseId]/`にそれぞれトグルボタンがある。複製したペルソナは既存のF04承認
    ワークフロー(`status='draft'`から)にそのまま乗り、複製した教材はStorageファイルも
    コピーしたうえでRAGは複製先の授業で改めて生成する(F02の仕組みをそのまま使う)。
    `origin_note`/タイトルに複製元の教師名を残す(帰属を追える形にする)
- `src/lib/supabase/server.ts` — Supabase管理者クライアント(`createAdminClient()`、
  service roleキー、RLSを常にバイパスする)。このアプリはSupabase Authを使わず
  (認証はAuth.jsのCredentialsプロバイダー)、DBアクセスは常にこのクライアント経由で行う
  (以前あった未使用のブラウザ用クライアント`client.ts`は削除済み)
- `src/lib/courses/ownership.ts` — `assertOwnsCourse()`: 教師が自分の授業を操作しているかの
  確認(RLS未整備な段階1のアプリ側ガード)。`courses/[courseId]/`配下の複数のactions.tsから共用
  (テストは同ディレクトリの`ownership.test.ts`)
- `src/lib/courses/enrollment.ts` — F01拡張(受講登録)。`requireEnrollment()`(ページ側、
  未登録なら`/learn?not_enrolled=1`へリダイレクト)・`isEnrolled()`(真偽値、サーバー
  アクション側の防御用)(テストは同ディレクトリの`enrollment.test.ts`)
- `src/lib/consent.ts` — F16。`requireConsent()`: 同意していない/撤回済みの学習者を
  `/consent`へリダイレクトする(`learn/`配下の各ページから呼ぶ。テストは`consent.test.ts`)
- `src/lib/persona-mention.ts` — F05。`isPersonaMentioned()`: 学習者・擬似メンバーの発言に
  特定のペルソナが名指しされているかを、正式名の末尾一致(3文字以上)で判定する
  (`learn/[courseId]/actions.ts`の`pickRespondingPersona`から使う純粋関数。
  "use server"ファイルはasync関数以外exportできないため別ファイルに切り出した。
  テストは`persona-mention.test.ts`)
- `src/lib/ai/` — ペルソナ対話(`persona.ts`)、論証評価(`argument-evaluation.ts`)、
  観点別AIフィードバック(`feedback.ts`、F07。`argument-evaluation.ts`とは別物:
  こちらは点数を返さず、教師が設定した観点ごとの助言を構造化出力で返す)、
  学習者プロファイル要約(`student-profile.ts`、F09)、
  学習進化型ペルソナの抽出・役割分類(`evolved-persona.ts`、F10)、
  個別最適化の提案生成(`personalization.ts`、F11)、
  手書き画像の認識(`handwriting.ts`、F12。マルチモーダル入力で文字を書き起こし、
  図・イラストは「[図: 説明]」の形で言葉に変換する)、
  音声の文字起こし(`audio.ts`、F13。OpenAIの音声文字起こしAPIを使う)、
  ペルソナのアバター推薦(`persona-avatar.ts`、F25。候補の画像そのものではなく、各候補に
  付けたラベル・タグ(テキスト)だけを`MODEL_JUDGE`に渡して選ばせる。画像を都度生成/都度
  読ませるコストをどちらも避けるため)、
  横断的な学びの記録に基づく学習者向け提案生成(`learner-suggestions.ts`、F26。
  `personalization.ts`(F11)と4観点は同じだが、教師がペルソナに反映するF11と異なり
  学習者本人にそのまま提示するため、促し方・難度調整を「学習者自身の行動」に
  読み替えた別プロンプト・別スキーマにしてある。プロファイル要約自体は`student-profile.ts`
  (F09と共通)をそのまま使う)、
  OpenAIクライアント(`openai.ts`。`MODEL_TRANSCRIBE`もここで定義)
- `src/lib/rag/` — F02(RAG生成)。`extract.ts`(PDF/Word/PPT/字幕/URLからテキスト抽出)、
  `chunk.ts`(文字数ベースの簡易チャンク分割)、`generate.ts`(抽出→分割→埋め込み→
  `material_chunks`保存までの一連の処理。失敗時は`course_materials.rag_status='failed'`
  + `rag_error`に理由を記録し、教師が「再生成」できるようにする)。
  `search.ts`はF05用: 学習者の発言を埋め込み、`match_material_chunks`(Postgres RPC、
  `0005_persona_dialogue.sql`)でコサイン類似度検索する
  (supabase-jsだけではベクトル距離の並び替えを書けないためDB関数にした)
- `src/lib/auth/` — パスワードハッシュ(`password.ts`)、ロール確認ヘルパー(`session.ts`)、
  F22用のSSOアカウント紐づけ(`sso.ts`の`linkOrCreateSsoProfile`)
- `src/auth.ts` — Auth.js設定。Credentialsプロバイダー(段階1、profiles.email /
  password_hash を照合)に加えて、F22用にMicrosoft EntraID / Googleプロバイダーを、
  対応する環境変数が設定されている時だけ`providers`配列に加える(未設定でもbuildは通る)。
  SSOでのサインインは`signIn`コールバックで`linkOrCreateSsoProfile()`を呼び、
  (1)同じprovider+subjectの既存行があればそれを使う(生徒の進級後もポートフォリオが
  引き継がれる、要件定義書6章・12章)、(2)無ければメールアドレスで段階1のCredentials
  アカウントに一度だけ統合する、(3)どちらも無ければ新規作成する(役割は自動判定できない
  ため既定で`student`。教師アカウントへの昇格は今のところ手動)。IdPのテナントID
  (EntraIDの`tid`、Googleの`hd`)から`organizations`(F21で使っているテーブル)を
  自動的に判定・作成し、`profiles.organization_id`に割り当てる。
  自己登録の承認制(`signup/`)と整合させるため、(1)承認待ち・却下された教師はSSO/LTI経由でも
  入れない、(2)既存アカウントとのメール統合は、IdPがメールを確認済みと保証する時
  (Googleの`email_verified`)に限り、統合時に既存のパスワードも無効化する
  (他人のメールで先に自己登録しておく乗っ取り=pre-hijackingの対策。Microsoft(Entra ID)の
  emailクレームは確認済みの保証が無いため統合しない)。Microsoftは`AUTH_MICROSOFT_ENTRA_ID_ID`と
  `..._ISSUER`の両方が揃った時だけ有効(IDだけだとAuth.jsの設定エラーで認証全体が壊れる)。
  ログイン画面のボタンには各社公式のロゴ(`src/components/provider-logos.tsx`)を使い、
  SSOで入れなかった理由は`?error=`で表示する。
  Googleでメール統合された既存アカウントはパスワードが無効になり、以後Googleだけで入る
  (本番の管理者`kobae.lab@gmail.com`が該当。Googleが使えなくなった時に備え、必要なら
  `scripts/dev/create-user.mjs`でパスワードを再設定できる)
- `src/lib/lti/` — F17(LMS連携、LTI 1.3)。単一のLMSプラットフォームを前提にした
  最小構成(複数LMSに対応する場合は`config.ts`をDBテーブルに置き換えること)。
  対応する環境変数(`LTI_PLATFORM_*` / `LTI_TOOL_*`)が揃っていない限り、
  `config.ts`の`getLtiConfig()`が`null`を返して機能全体を無効化する(F22と同じ方針)。
  - `config.ts` — 環境変数の読み込み
  - `keys.ts` — このツール自身のRSA鍵(`LTI_TOOL_PRIVATE_KEY`、
    `scripts/dev/generate-lti-keys.mjs`で生成)。`getToolJwks()`が`/api/lti/jwks`で
    配信する公開鍵セットを作る(秘密鍵の情報は含めない)。`signWithToolKey()`・
    `signDeepLinkingResponse()`はDeep Linking応答や成績連携(AGS)の署名に使う
  - `claims.ts` — id_tokenのクレーム型と、`mapLtiRolesToAppRole()`(LTIのroles claimを
    teacher/studentに対応付ける。SSO(F22)と違いLTIは役割情報をくれるため、新規作成時に
    活用できる。判定できなければ安全側のstudentにする)
  - `verify.ts` — プラットフォームのid_tokenを、プラットフォームのJWKS(リモート)で検証する
    (`iss`/`aud`/`nonce`/`deployment_id`の一致を確認)
  - `session.ts` — `linkOrCreateLtiProfile()`。F22の`sso.ts`と同じ考え方
    (`lti_issuer`+`lti_subject`の組で永続的に同じ人物を指す。既存のCredentials/SSO
    アカウントがあればメールで一度だけ統合)
  - `handoff.ts` — `/api/lti/launch`でのid_token検証と、NextAuthのセッション確立を
    つなぐ短命な受け渡しトークン(`AUTH_SECRET`で署名、60秒で失効)。詳細は`src/auth.ts`の
    コメント参照(プラットフォームのid_tokenをCredentialsプロバイダーへ直接渡さない設計)
  - `ags.ts` — 成績連携(Assignment and Grade Services)。OAuth2 client_credentialsで
    アクセストークンを取り(認可はこのツールの秘密鍵で署名したJWTクライアント資格情報
    アサーション)、`lti_resource_links.lineitem_url`の`/scores`エンドポイントへ
    スコアをPOSTする(`sendScoreToLms()`)
  - ローンチのURL構成: `/api/lti/login`(サードパーティ開始ログイン、state/nonceを
    Cookieに保存してプラットフォームへリダイレクト)→ プラットフォームでの認証 →
    `/api/lti/launch`(id_token検証→profile紐づけ→受け渡しトークン発行→
    `signIn("lti", ...)`)→ `/lti/continue`(ローンチ文脈のCookieを見て、Deep Linking
    なら`/courses/lti-deep-link`、通常のリソースリンク起動ならDBで紐づく授業を見つけて
    リダイレクト)。Deep Linking(教師がLMSの課題作成画面でSynclieの授業を選ぶ場面)は
    `/courses/lti-deep-link`で授業を選び、`/courses/lti-deep-link/submit`が署名済み
    JWTを含むフォームをLMSへ自動送信する。教材(単元)の対応先はresource_link_idだけでは
    最初の起動時にまだ分からないため、Deep Linkingで返すcontent itemの`url`に
    `course_id`を埋め込み、`/api/lti/login`がそれを拾って`lti_resource_links`
    (`issuer`+`deployment_id`+`resource_link_id`で一意)に初回登録する設計にしている
  - `learning_sessions.lti_resource_link_id`(`learn/[courseId]/actions.ts`の
    `getOrCreateSession`が、`/lti/continue`が設定したCookieから読んで記録)で、
    「この学習セッションはどの課題(リソースリンク)経由か」を追跡し、F24の議論ジャッジを
    成績としてLMSへ送信できるようにする(`courses/[courseId]/submissions/`の
    「LMSに成績を送信する」ボタン、`sendGradeToLmsAction`)
  - **実際のLMSへのツール登録(Canvas等の管理画面、人手が必要)はまだ行っておらず、
    実際のLMSとの連携は未検証。** 鍵生成・JWKS配信・JWT署名/検証・受け渡しトークンの
    往復・役割マッピングはローカルのスクリプトで単体検証済み(モックのプラットフォーム値を使用)
- `supabase/migrations/` — DBスキーマ
  - `0001_init.sql` — 初期骨組み(要件定義書6章参照)
  - `0002_auth_and_materials.sql` — ログイン用カラム(profiles.email/password_hash)、
    `course_materials`テーブル(F01)、Storageバケット`materials`
  - `0003_rag_pipeline.sql` — F02用。`material_chunks`に`material_id`/`chunk_index`/
    `char_count`を追加(どの資料の何番目のチャンクかを追跡し、再生成時に該当資料の
    チャンクだけ削除・作り直しできるようにする)。`course_materials.rag_error`も追加
  - `0004_persona_approval.sql` — F04用。`personas.status`(`draft`/`approved`/`active`)を追加
  - `0005_persona_dialogue.sql` — F05用。`match_material_chunks` RPC(授業RAGのベクトル検索)を追加
  - `0006_submissions.sql` — F06用。学習者の「成果」を保存する`submissions`テーブルを追加
  - `0007_feedback.sql` — F07用。`evaluation_criteria`(観点)・`submission_feedback`
    (観点ごとのAIフィードバック)テーブルと、`submissions.feedback_status`/`feedback_error`を追加
  - `0008_reflections.sql` — F08用。学習者の振り返り(学んだこと/迷ったこと/次にやりたいこと)を
    保存する`reflections`テーブルを追加。`shared_with_teacher`で教師への共有可否を選べる
  - `0009_student_profiles.sql` — F09用。学習者プロファイル(得意な点/課題/学習履歴の要約)を
    学習者×授業単位で保存する`student_profiles`テーブルを追加
  - `0010_consent.sql` — F16用。学習者の同意状況を保存する`consent_records`テーブルを追加
    (学習者1人1行。撤回は`withdrawn_at`を立てるだけで、再同意すれば使い直せる)
  - `0011_conformity_measurement.sql` — F20用。`argument_evaluations`に`persona_id`
    (非正規化、ペルソナ単位の集計用)・`persona_conceded`・`unwarranted_conformity`を追加
  - `0012_evolved_personas.sql` — F10用。抽出結果(論点/誤概念/有効な問い)を保存する
    `learner_corpus_entries`テーブルと、`personas.origin_note`(生成理由の説明文)を追加
  - `0013_personalization.sql` — F11用。個別最適化の提案(同じ誤解を避ける問い/探究テーマ/
    促し方/難度・足場かけ)を保存する`personalization_suggestions`テーブルを追加。
    `status`(suggested/accepted/declined)で採用可否を管理する
  - `0014_handwriting.sql` — F12用。手書き画像用の非公開Storageバケット`handwriting`と、
    認識結果を確認・修正してから送信するまでの一時テーブル`handwriting_uploads`
    (`status`: recognizing/ready/failed/confirmed)を追加。`dialogue_turns`に
    `source_kind`(text/handwriting/audio)と`image_path`を追加し、確定後は
    テキスト発言と同じ行の形で保存できるようにする
  - `0015_audio_input.sql` — F13用。音声ファイル用の非公開Storageバケット`audio`と、
    文字起こし結果を確認・修正してから送信するまでの一時テーブル`audio_uploads`
    (`status`: transcribing/ready/failed/confirmed)を追加。`dialogue_turns.image_path`は
    手書き専用の名前だったため、音声の元データパスも持たせられるよう`source_path`に改名
  - `0016_persona_audit.sql` — F15用。`dialogue_turns`に`flagged_by_teacher`・
    `teacher_note`を追加し、教師が擬似メンバーの発言を確認・修正した状態を直接持たせる
  - `0017_solo_study_mode.sql` — F19用。`courses.mode`(`group`/`solo_study`、既定は
    `group`)を追加。`learning_sessions.mode`は0001_init.sqlの時点で既に
    `solo_study`を許容していたため、新しい対話機構は不要だった
  - `0018_enable_rls.sql` — セキュリティ修正。publicスキーマの全テーブルでRLSを有効化
    (ポリシーは無し。service roleキーは常にRLSをバイパスするため、アプリの動作は変わらない)
  - `0019_teacher_collaboration.sql` — F21用。`organizations.approver_teacher_id`
    (組織をまたぐ共有の承認者)、`personas.shared_at` / `course_materials.shared_at`
    (共有ライブラリへの公開)、`share_requests`テーブル(組織をまたぐ共有リクエストの
    pending/approved/declined管理)を追加
  - `0020_sso.sql` — F22用。`profiles.sso_provider`/`sso_subject`(provider+subjectで
    一意)と`organizations.sso_tenant_id`(一意)を追加。password_hashは残したまま、
    SSOのsubject idを別キーとして持たせる
  - `0021_student_dashboard.sql` — F23用。学習者が自分で追加・完了・削除できる
    学習計画のTODOリスト`study_plan_items`を追加(授業への紐づけは任意)
  - `0022_discussion_judgment.sql` — F24用。`submissions.judgment_status`/
    `judgment_error`(F07のfeedback_status/feedback_errorと同じパターン)と、
    議論全体を通してのAIジャッジ結果を1提出物1件で保存する`discussion_judgments`を追加
  - `0023_lti_integration.sql` — F17用。`profiles.lti_issuer`/`lti_subject`
    (組で一意)、LMS側のリソースリンク(課題)とSynclieの授業を対応付ける
    `lti_resource_links`(成績連携先の`lineitem_url`を持つ)、
    `learning_sessions.lti_resource_link_id`を追加
  - `0024_persona_avatars.sql` — F25用。全授業共通のアバター候補プール`avatar_options`
    (`file_path`/`label`/`tags`。画像本体は`public/avatars/`のSVG)を追加し、16件を
    シードする。`personas`に`avatar_id`(参照。削除時は null に戻す)・`avatar_status`
    (`pending`/`done`/`failed`)・`avatar_error`を追加(F02/F07などと同じ status/error 列)
  - `0025_cross_course_learning_profile.sql` — F26用。`learner_profiles`(横断プロファイル、
    学習者1人1行)・`learner_suggestions`(横断的な提案、学習者1人1行)を追加。
    F09/F11の`student_profiles`/`personalization_suggestions`と違い`course_id`を持たない
    (`student_id`に`unique`制約)。F11と違い教師の採用ワークフロー(status)も持たない
    (学習者本人にそのまま見せる提案のため)
  - `0026_avatar_illustrations.sql` — F25用。`avatar_options.file_path`をコード生成の
    `.svg`からユーザー用意の`.png`イラストに向け直すupdate文(16件。行・スキーマ自体は変更なし)
  - `0027_auto_discussion_tempo.sql` — F05拡張。「テンポ」(沈黙時の自動継続)用に
    `courses.auto_discussion_tempo_seconds`/`auto_discussion_affects_evaluation`、
    `learning_sessions.auto_discussion_tempo_seconds`、
    `dialogue_turns.auto_generated`を追加(詳細は8章の`learn/`の説明を参照)
  - `0028_course_enrollments.sql` — F01拡張(受講登録)。`courses.join_code`
    (参加コード、列デフォルト式で新規作成時に自動生成)と`course_enrollments`
    (course_id+student_idの組、unique制約)を追加。既存の`learning_sessions`から
    参加登録済み扱いのバックフィルも行う(詳細は8章の`learn/`の説明を参照)
  - `0029_signup_approval.sql` — 自己登録の承認制。`profiles.approval_status`(`pending`/
    `approved`/`rejected`、既定`approved`)・`profiles.is_admin`、`course_enrollments.status`
    (`pending`/`approved`、既存の登録は承認済み扱い)を追加(詳細は8章の`signup/`の説明を参照)
- `scripts/stage0/` — 段階0の使い捨てプロトタイプ(`debate_experiment.py`)。
  ペルソナ対話と論証評価の「質感」を、画面なしでローカル検証するためのCLIスクリプト。
  段階1のNext.js実装に置き換わる前提の使い捨てコード。
- `scripts/dev/create-user.mjs` — 開発用: テストアカウント(教師/生徒)を作成するスクリプト。
  サインアップ画面はまだないため、当面はこれでアカウントを作る
  (`node --env-file=.env.local scripts/dev/create-user.mjs --email ... --password ... --role teacher`)。
- `scripts/dev/generate-lti-keys.mjs` — F17用: このツール自身のRSA署名鍵ペア(PKCS8 PEM)を
  生成し、`.env.local`に貼り付ける`LTI_TOOL_PRIVATE_KEY`/`LTI_TOOL_KEY_ID`を出力する
  (`node scripts/dev/generate-lti-keys.mjs`)。

### UIレビューでの指摘と対応(2026-09-26)

実機で全画面を教師・生徒両方の操作で通しレビューした結果、MVP(段階1)のロジック自体は
高品質に動いている一方、以下の基礎的なUI基盤が未整備だった。優先度の高い3点は対応済み:

- **グローバルナビゲーション皆無**(対応済み): `src/app/layout.tsx`にヘッダーを追加(上記参照)。
- **狭い画面幅でのレイアウト崩れ**(対応済み): `flex items-center justify-between`のような
  「右詰めボタン列」パターンに`flex-wrap`が付いておらず、タブレット幅などでボタンが画面外に
  はみ出す/テキストが1文字ずつ縦に割れる、という崩れが複数画面(ペルソナ一覧・学習者
  ダッシュボード・共有ライブラリ等)で発生していた。**この種の行を新しく書く時は
  必ず`flex flex-wrap items-center justify-between gap-x-3 gap-y-1`のように
  `flex-wrap`と縦方向の`gap`を付けること**(このアプリはブレークポイント(`sm:`等)を
  一切使わない方針のため、`flex-wrap`だけで崩れを防ぐ)。
- **サーバーアクション実行中のフィードバック皆無**(対応済み): `src/components/submit-button.tsx`の
  `SubmitButton`を、AI呼び出し・外部API呼び出しを伴うボタンに適用済み(上記参照)。
  **新しくAI呼び出しを伴うボタンを追加する時は、素の`<button type="submit">`ではなく
  `SubmitButton`を使うこと**。

未対応(把握はしているが今回は対応していない、優先度順):
- 授業詳細ページ(`courses/[courseId]/page.tsx`)の導線が、資料が無い段階でもF14〜F15までの
  リンクが平文で並ぶだけで、初めての教師への誘導が弱い。生徒ビューへの導線も
  `/learn/<uuid>`という生のURLを教師に手打ちさせる形のまま
- 資料の種類「テキスト」を選んでも、直接テキストエリアに貼り付ける経路が無く、
  ファイルアップロードのみ(`src/lib/rag/extract.ts`)
- URL資料の取り込み(`extractFromUrl`)がHTMLのnav/footer等のボイラープレートを除去せず、
  本文と一緒にRAGへ入ってしまう(`src/lib/rag/extract.ts`の`htmlToText`)
- F24(AIジャッジ)の結果が`learn/[courseId]/portfolio/page.tsx`(F08ポートフォリオ)に
  表示されない(discussion_judgmentsへの参照が無い)
- F04(下書き→承認→使用中)は意図的な安全設計だが、1体だけ素早く試したい時でも
  必ず2回の操作(承認する→授業で使う)が要る。ショートカットは無い

### 認証まわりの注意(重要・要フォローアップ)

- RLS(Row Level Security)は`0018_enable_rls.sql`で全テーブル有効化済み。ただし**ポリシーは
  まだ無い**。アプリはservice roleキー(`createAdminClient()`、RLSを常にバイパスする)だけで
  DBにアクセスしており、教師専用ページは`src/lib/auth/session.ts`の`requireRole()`による
  アプリ側のロールチェックで保護している。ポリシーが無い状態でRLSを有効にしているのは、
  「anon/authenticatedキーが漏れても何も読み書きできない」ようにする最低限の保険であり、
  本番投入前には別途、`courses.owner_teacher_id` / `course_materials.uploaded_by` /
  `student_id`ベースのポリシーを追加すること。
  **新しいテーブルを追加するたびに、そのマイグレーションで`alter table ... enable row
  level security;`も必ず一緒に実行すること**(ポリシーは無くてよいが、RLS自体は毎回有効化する)。
- 段階1のCredentials認証は自前のパスワードハッシュ(bcrypt)を`profiles`に保存する方式。
  段階2でSSO(F22)に移行する際、`password_hash`列はそのまま残しつつ、
  SSOプロバイダーのsubject idを別途キーとして使う設計にする(要件定義書6章・12章参照)。
- **本番は自己登録を承認制にしている**(上記`signup/`)。Supabaseは2026-10-20に開発用と本番用に分離した
  (開発: `rcirkcyrqsaapxzkvhqa`=手元の`.env.local`とCLIのリンク先、本番: `xdbkbbvrnmuhsjpmueev`=VPS)。
  開発用のテストアカウントは開発DBに作ること(本番のDBに弱いパスワードのアカウントを作らない)。
  本番へのマイグレーションは、`supabase link`を本番に向け直して`db push`し、終わったら開発へ戻す。メール確認(メールアドレスの実在確認)の仕組みは
  まだ無い(メール送信の基盤が無いため)。同じIPからの大量登録を抑えるレート制限も未実装
- 受講登録(どの学習者がどの授業に属するか)は`course_enrollments`+授業コード
  (`courses.join_code`)で実装済み(詳細は8章の`src/app/learn/`の説明を参照)。
  ただしRLSポリシーはまだ無いため、このテーブルもアプリ側のガード
  (`requireEnrollment`/`isEnrolled`)だけに依存している点は他のテーブルと同じ。

## 9. 開発の進め方

- ブランチは機能ID(F01, F02, …)ベースで作成する。
- ロードマップ(要件定義書11章): 段階1 = F01–F09, F16, F20 / 段階2 = F10–F15, F19, F21–F24, F26 / 段階3 = F17, F18, F25
- 段階0〜1はコストを最小化する(安価モデル優先、論証評価の呼び出し回数を絞る、支出上限を設定・監視する)。
- 実装前に要件定義書の該当章を確認し、齟齬があれば要件定義書を更新してから実装する
  (要件定義書が「正」。このCLAUDE.mdは早見表であり、詳細判断の根拠にはしない)。
- **自動テスト**: `npm test`(vitest)。CIも自動テストも無い状態が長く続き、話者選択の
  不自然さ・複数ペルソナでの反論不成立・受講登録の抜け穴など、実機で人手が触るまで
  気づかれない構造的な不具合が何度か起きたため導入した。実際のSupabaseやNext.jsの
  ランタイムには繋がず、権限境界の関数(`assertOwnsCourse`/`requireConsent`/
  `requireEnrollment`・`isEnrolled`)が受け取る`admin`クライアントを、その関数が
  実際に呼ぶメソッド連鎖(`.from().select().eq().maybeSingle()`等)だけを実装した
  最小限の偽クライアントに差し替えてテストする方針(`src/lib/courses/ownership.test.ts`
  等を参照)。`next/navigation`の`redirect()`もテスト内でモックし、呼ばれたかどうかを
  検証する。`requireAdmin`/`isAdmin`(`src/lib/auth/session.test.ts`)、`isEnrolled`が承認済みだけを参加扱いにすること、
  サインアップの入力チェック(`signup-validation.test.ts`)も同じ方針でカバーしている。
  **「誰がどの授業・どの学習者データに触れるか」という権限境界に新しい分岐を
  加えたら、ここにもテストを足すこと**(DBに触れない純粋なロジック、例えば
  `src/lib/persona-mention.ts`の名指し判定なども同様の対象)。網羅的なテストは目指さず、
  「書き忘れても`tsc`/ESLintでは気づけない」種類のバグ(権限チェックの抜け漏れ)を
  優先的にカバーする。

## 10. 未解決の論点(要件定義書12章より抜粋)

- 卒業・転校時のポートフォリオの引き継ぎ方法
- 低学年向けの代替ログイン手段(QRコード・絵柄パスワード等)
- 組織を跨ぐペルソナ・教材共有の承認者フローの具体設計
- 段階0〜1のコスト上限の具体的な数値設定と監視方法
