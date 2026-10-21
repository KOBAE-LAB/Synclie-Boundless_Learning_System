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

- **配色・ロゴ**: **白背景の明るいテーマ**(2026-10に変更。「明るい雰囲気で学習できるように」という
  要望)。ブランドの深紅(ロゴのリング)をアクセント、ヘルメットの黄を警告・強調に使う。
  `src/app/globals.css`の`@theme`ブロックのトークン(canvas/surface/ink/accent/danger/success/warn等)
  を変えれば、画面全体の配色が変わる(色を直接書かず、必ずトークンを使うこと)。文字・背景の
  コントラストは白地で4.5:1以上(WCAG AA)。**文字の大きさ**は`html { font-size: 112.5% }`
  (標準の約112%)で、Tailwindのrem基準の文字・余白がそろって大きくなる(**px指定の文字サイズは
  使わず、remを使うこと**)。
  **フォントと太さ**(2026-10): 「全体的に文字が細くて見づらい」という指摘を受け、日本語フォントを**Noto Sans JP(可変、
  `@fontsource-variable/noto-sans-jp`、OFL)を自サーバーから配信**する形にした(`layout.tsx`でCSSを読み込み、
  文字の範囲ごとに分割されているので使う分だけ読み込まれる。外部のフォントサービスには依存しない)。以前は
  ヒラギノ角ゴ(通常がW3=細い)や游ゴシックを先頭にしていたため、OSによって細く見えた。**本文の太さは500**にし、
  強調との差を保つため`@theme`で`font-normal=500`・`font-medium=600`・`font-semibold=700`に上書きしている
  (Tailwindの標準値とは違う)。小さい文字は`--text-xs`を0.8125remに、補足の文字色(`ink-muted`/`ink-faint`)も
  少し濃くした。`-webkit-font-smoothing: antialiased`は文字が細く見えるので付けないこと以前は黒基調のダークテーマで姉妹アプリ「Synclie - Share」と値を
  揃えていたが、学習者が長く読み書きする画面が中心のため、読みやすさを優先して明るくした。
  姉妹アプリは黒基調のままで、もう揃っていない(揃えるかは別途判断)。教室のプロジェクタで
  明るすぎる場合の暗いテーマへの切り替えは、今は用意していない。ライト/ダーク自動切替はしない。
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
  - **管理者の「学習者として表示」(動作確認用)**: 管理者(教師アカウント)は`/learn`に入れず、
    学習者の画面を自分で確かめられなかったため追加した。授業の管理画面(`courses/[courseId]/`)の
    ボタンから`startStudentViewAction`(管理者かつ授業の所有者のみ)で、管理者ごとに専用の
    「テスト学習者」(`profiles.test_owner_id`、パスワード・メール無し=直接ログイン不可。
    `src/lib/auth/view-as.ts`)をその授業の受講者(承認済み)にし、切り替え中の印の
    Cookie(`synclie_view_as`、httpOnly、8時間)を付ける。`requireRole("student")`と
    `getEffectiveStudent()`(`src/lib/auth/session.ts`)が、**Cookieを信用せず、毎回
    本人が管理者であることをDBで確かめた上で**テスト学習者として扱う(管理者以外が
    Cookieを偽装しても無効。テストあり)。切り替え中は全ページ上部にバナーを出し、
    「管理者に戻る」(`app/view-as-actions.ts`)かログアウトで終わる。発言・提出はテスト学習者の
    データとして記録され、F10(学習進化型ペルソナ)のコーパスには含めない。
    学習者のAPI(`app/api/learn/[courseId]/message/route.ts`)も同じ`getEffectiveStudent()`を使う。
    一般の教師には使わせていない(他人として画面を見られる機能のため、管理者だけ)
  - `src/app/account/password/` — ログイン中の本人がパスワードを変える(現在のパスワードが必須)。
    教師が直接登録した学習者の初期パスワードを本人に変えてもらうために置いた。
    ヘッダー(`layout.tsx`)に常にリンクがある。SSO/LTIのアカウントはパスワードを持たないため変更不可
  - `src/app/consent/` — F16(同意・データ管理)。学習者が同意していない/撤回済みの場合、
    `src/lib/consent.ts`の`requireConsent()`がここへリダイレクトする
    (`/learn`, `/learn/[courseId]`, `/learn/[courseId]/portfolio`から呼んでいる)。
    同意すると`consent_records`に記録され`/learn`に戻る。
    **同意画面は、データの利用に加えて「AIの利用について」を説明する**(AIを使う場面・AIに送る内容(氏名・メールは送らない)・
    OpenAI(米国)へ送るため国外で処理されうること・OpenAIの扱い・AIの誤りと評価の最終判断・入力しないでほしいこと)。
    プライバシーポリシー(`privacy/`)の3章と内容をそろえてある(**OpenAIでの保管・学習への利用の記述は、OpenAIの現在の方針に
    基づく。運営者が公開前に最新の公式の案内で確認すること**)。説明文を大きく変えたら`src/lib/consent.ts`の
    `CONSENT_TEXT_UPDATED_AT`を新しくする(それより前に同意した学習者は、`/learn`に入る前に再同意になる。
    F10・教師向けの指導のヒントは、撤回していない同意を対象にしていて、再同意の有無までは見ていない)
  - `src/app/learn/portfolio/` — ポートフォリオ(学習者本人の「学びのデータベース」。EduDX方針の
    「学習者が所有し持ち出せる学びの記録」)。全授業を横断し、成果(`submissions`)に、議論のまとめ
    (`learning_sessions.closing_summary`)・AIフィードバック・AIジャッジ・振り返りを束ねて時系列表示する
    (コピーは作らず`src/lib/portfolio/load.ts`の`loadPortfolio`が読むだけ)。授業・年度(4月始まり、日本時間)で
    絞り込める。新しく保存するのは`portfolio_entries`(成果1件ごと: 自己評価`self_assessment`・教師評価
    `teacher_assessment`・公開用の印`shared`)と`portfolio_share_links`(本人が作る、期限つき
    7/30/90日・取り消せる公開リンク)だけ(`0035_portfolio.sql`)。**AIの評価は材料にとどめ、最終判断は
    本人と教師**(画面・書き出しに必ず注記)。書き出しは`GET /api/learn/portfolio/export?format=html|md|json&course=`
    (本人のデータだけ。同意撤回中でも持ち出せる)。公開リンク`/portfolio/shared/[token]`はログイン不要・noindex・
    無効理由を区別せず404で、`toSharedView`が「公開用」の成果だけを残し振り返り・AIフィードバックを外す。
    **進級・転校の引き継ぎは自動では行わず、このリンクか書き出しで本人が渡す(オプトイン)**。
    教師の評価は`courses/[courseId]/submissions/`の`saveTeacherAssessmentAction`(自分の授業のみ)。
    旧`learn/[courseId]/portfolio/`はここへリダイレクトする。`deleteMyDataAction`は
    `portfolio_share_links`も削除する
  - `src/app/learn/data/` — F16用。学習者が自分の同意状況の確認・撤回(利用停止)、
    保存データ件数の確認、全データ削除(`deleteMyDataAction`。ログインアカウント自体は
    残す)ができる。同意状況に関わらずアクセスできる(撤回中でもここは使える)。
    学習者に紐づくテーブルを追加するたびに、ここも合わせて更新すること(F12実装時に
    手書き画像のStorageファイル削除と、抜けていたF11の`personalization_suggestions`削除を
    追加で拾った。F13実装時に音声ファイルの削除も同様に追加した。F23実装時に
    `study_plan_items`削除も追加した。F24実装時に`discussion_judgments`削除も追加した。
    F26実装時に`learner_profiles`/`learner_suggestions`削除も追加した。0042で、本人の個人プロジェクト
    (`inquiry_projects.solo_student_id`)の削除と、グループのプロジェクトからの脱退(`inquiry_project_members`)を追加した。
    記録がプロジェクトを参照しているため、記録を消した後に消す)
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
    **「次の学びに向けて」(2026-10)**: 「学習者用ダッシュボードでは、次の学びに向けてどう努力すればよいかを
    サジェストしてほしい」という要望を受け、F26の提案を努力の方向づけとして整理した。材料に
    ポートフォリオの**自己評価・教師のコメント・AIジャッジ(非最終と明記)**も加え、プロンプトは
    「小さく具体的な次の一歩」「点数や他者比較で励まさない」「自己評価・教師のコメントをAIの見方で
    上書きしない」にした。各提案に「学習計画に取り入れる」ボタン(`addSuggestionToPlanAction`)があり、
    取り入れた提案は`study_plan_items`に入る(提案の文面はクライアントから受けず、本人の保存済みの提案から
    読む。AIが勝手に計画へ入れることはしない)
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
    get-or-createし、発言のたびに`src/lib/learn/dialogue.ts`の`postStudentMessageAndRespond`が
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
    **応答速度の改善(2026-10)**: 「学習画面のレスポンスを上げたい」という要望を受け、まず実測した
    (開発環境で、DB準備約1.6秒+論証評価AI約4.6秒+返答AI約2.3秒=約8.5秒。**大半はAIの待ち**)。
    (1)テキスト発言の送信は、サーバーアクションをやめて**ストリーミングAPI**
    (`app/api/learn/[courseId]/message/route.ts`、NDJSON)にした。処理の本体は
    `src/lib/learn/dialogue.ts`に切り出し(`"use server"`ファイルはasync関数以外をexportできず、
    APIからも呼ぶため)、手書き・音声の確定(サーバーアクション)も同じ関数を共用する。
    返答は構造化出力`{reply, conceded}`のまま流し、`src/lib/ai/partial-json.ts`の
    `extractPartialJsonString`で届いた分の`reply`だけを取り出して順次画面に渡す
    (`askPersonaStream`)。(2)画面側は`src/components/chat-composer.tsx`(クライアントJSが必要な
    4つ目の理由)が、送信した瞬間に自分の発言と「考えています」を出し、返答を流れるように
    表示する(完了後に`router.refresh()`でサーバー描画のやり取りに切り替え、件数が増えた時点で
    仮表示を消す)。APIは`Cache-Control: no-transform`と`X-Accel-Buffering: no`を返す
    (Nextの圧縮・nginxのバッファが応答をためこむとストリーミングが効かないため)。
    (3)独立なDB問い合わせは`Promise.all`で並行化(`dialogue.ts`と`learn/[courseId]/page.tsx`。
    ページの再取得は約2〜3秒→約0.6秒)。**やらなかったこと**: AIの推論の深さ(reasoning effort)を
    下げる案は、速くなるとは限らず、論証評価の判定(新しい根拠の有無)が変わってしまったため
    採用しなかった(F20の計測の精度に直結するため)。**論証評価と返答を同時に実行する案**は、
    評価結果をペルソナへの指示に使う設計(F20)を変えるため、実時間は約3〜5秒縮むが
    採用していない(研究設計の判断が要る)。
    **ペルソナの「考え方の深さ」「返答のテンポ」と、AIの「推論の深さ」(2026-10)**: 「ペルソナの思考
    レベルやレスポンス速度も設定で変えられるように」という要望。3つの設定を分けて持つ。
    (1)**考え方の深さ**(ペルソナごと、直感的/標準/じっくり論理的): `personas.behavior_rules.thinkingDepth`
    (jsonbなので列の追加は不要。未設定は標準)。**AIの素の性能は変えず**、そのペルソナの考え方・文量の
    指示(`persona-traits.ts`の`THINKING_DEPTH_GUIDANCE`)として、場面生成と1人用のプロンプトに入る。
    (2)**返答のテンポ**(ペルソナごと、すばやい/ふつう/ゆっくり): `behavior_rules.replyTempo`。
    **画面での出方だけ**の個性(返答が出るまでの「入力中…」の間と、文字の出る速さ。ふつう=0.5秒+80字/秒、
    ゆっくり=1.5秒+30字/秒)で、**AIの実際の生成速度は変わらない**。`computePacing`(純粋関数、
    テストあり)が経過時間から表示を決め、`ChatComposer`は返答を出し終えてから画面を更新する
    (途中で切れないように)。複数人の場面は順番に出す。サーバーに保存される会話は、テンポに
    関係なく即座に全文が入る。(3)**AIの推論の深さ**(授業ごと、速さ優先/標準/じっくり、
    `courses.reasoning_depth`、`0034`): 擬似メンバーの発言を作る呼び出しの`reasoning.effort`
    (low/標準=指定なし/high)。**論証評価・議論のまとめ・状態判定には適用しない**(研究の計測や
    補助を、いつも同じ条件にするため)。複数人の場面は1回の生成なので、人ごとには分けられない
    (授業単位)。実測では、深さを変えても応答時間はほとんど変わらなかった(標準3.6秒/浅く2.6秒/
    深く3.3秒)ため、「速さ優先にすれば速くなる」とは言えない。AIによるペルソナ案は、メンバーごとに
    この2つを変えた個性で提案する。
    **学習画面のUI整理(2026-10)**: 「各ペルソナの吹き出しの色を変えたい。UI全体を見やすく・操作しやすく」
    という要望を受けて整理した。(1)**擬似メンバーごとの色**(`src/lib/persona-tones.ts`の
    `assignPersonaTones`/`toneClass`、`globals.css`の`.tone-0〜5`・`.persona-bubble`/`.persona-name`/
    `.persona-ring`/`.persona-chip`/`.persona-dot`): 授業内のペルソナを**作成順**に並べて6色を割り当てる
    (いつ見ても同じ人は同じ色。学習者の吹き出し・映像タイル・名前チップ・発言中の枠・ペルソナ設定の
    一覧が同じ色になる)。**新しい画面で擬似メンバーを表示するときは、この色を使うこと**。
    (2)学習者の画面の並びを、チャットの自然な順(映像タイル→会話→入力欄)に直した。それまでは入力欄が
    会話の**上**にあり、新しい発言が画面の下に埋もれていた。入力欄は画面の下に固定(`sticky`。親の
    枠の中でしか効かないため、`ChatComposer`はFragmentで返す)、送信・返答が流れる間は自動で見える
    位置へスクロールする。手書き・音声の入力は、折りたたみにまとめた。(3)教師の授業画面の
    リンクの羅列を、説明つきのメニューカードにした。ペルソナ設定は、一覧を上に、作成フォームを
    折りたたみに。アバター未設定のペルソナは、名前の頭文字を色の丸で表示する。
    **擬似メンバーの発話順(2026-10)**: 「必ずAIが1人話したあとに自分が入力するのは不自然。
    性格や視点から、その人が口を出すのが自然な時に口を出してほしい。AI同士の議論もあってよい」
    という要望を受け、擬似メンバーが2人以上いる授業では、学習者の発言1回につき必ず1人、という
    仕組みをやめた。`src/lib/ai/persona-scene.ts`の`askScene`が、**全メンバーの設定(立場・目標・口調・
    発言頻度・介入の条件)を一度に渡して、短い「場面」(1〜最大4発言)を1回の呼び出しで作らせる**。
    誰が・何人話すかはAIが決める(自分の視点に関わらない話題では黙ってよい、名前を呼ばれた人は
    必ず最初に答える、メンバー同士で名前を呼んで議論してよい、最後は必ず学習者に話を返す、
    既に出た内容を繰り返さない)。上限は授業設定の「擬似メンバーの発言の活発さ」
    (`courses.discussion_liveliness`: 控えめ2/普通3/活発4発言、`0033`)。ペルソナの設定項目の
    「発言頻度」「介入の条件」が、初めて実際に発言の判断に効く(それまではプロンプトに入るだけだった)。
    擬似メンバーが1人の授業は従来どおり1人(`askPersonaStream`)。画面には、話者が確定した発言から
    順に流れる(`components/chat-composer.tsx`、イベント`scene`、`partial-json.ts`の
    `extractPartialSceneMessages`)。沈黙時の自動継続(テンポ)も、2人以上なら最大2発言の場面にする
    (直前の発言を言い換えて繰り返さない指示付き)。**F20は保つ**: 論証評価は学習者の発言ごとに
    1回・独立に行い、「根拠なく同調したか」は**発言した擬似メンバーごと**に`argument_evaluations`へ
    1行ずつ記録する(点数は同じ値が重複するため、`courses/[courseId]/dashboard/page.tsx`の平均点は
    学習者の発言ごとに1回だけ数える)。「根拠が無ければ立場を変えない」原則は全員に適用する。
    **議論の「終わり」(2026-10)**: 「学習の終わりが設定しにくい。AIが判断して議論を中断させたり、
    制限時間を設定したりすることが必要」という指摘を受けて追加した。それまで学習セッションには
    終了の仕組みが無く(`learning_sessions.ended_at`は誰も設定していなかった)、議論は際限なく続いた。
    (1)**制限時間**(`courses.time_limit_minutes`、最初の発言から数える)。教師が授業設定で、
    超過したら「続けられる(超過は記録)」(soft)か「発言を止めてまとめへ」(hard)かを選び、
    「超過を評価の参考にする」(`time_limit_affects_evaluation`。学習者の画面に表示するだけで、
    AIが点数を変えるわけではない。テンポ設定と同じ考え方)も選べる。学習者の画面には
    `src/components/session-controls.tsx`が残り時間をカウントダウン表示する(サーバーが数えた
    経過時間を基準にし、端末の時計のずれに影響されない。クライアントJSが必要な5つ目の理由)。
    止める判断は画面ではなく、サーバー(`dialogue.ts`)が毎回行う。(2)**AIによる「まとめ」の提案**
    (`src/lib/ai/discussion-wrapup.ts`の`judgeDiscussionState`: 続ける/収束/堂々めぐり/脱線)。
    **AIが議論を止めることはせず、提案にとどめる**(学習者が「まとめに進む」か「もう少し続ける」を選ぶ)。
    AI呼び出しの費用を抑えるため、4発言目から2発言おきにしか判定せず(`session-end.ts`)、
    返答・論証評価と**並行**して実行するので返答を待たせない。制限時間を過ぎた場合はAIを呼ばずに
    提案する。教師は`ai_close_suggestion`で無効にできる。(3)**終了とまとめ**
    (`src/lib/learn/close.ts`の`closeDiscussion`、`app/api/learn/[courseId]/close/route.ts`):
    「まとめに進む」か、hardの時間切れで自動的に、AIが議論の要点・次に考える問いをまとめて
    `closing_summary`に保存し、`ended_at`/`end_reason`(time_limit/ai_suggested/student。
    **クライアントの申告は信用せず、サーバーが事実から決める**)を記録する。終了した議論には
    発言できず(手書き・音声も)、成果の提出(F06)・テンポ設定の保存だけが引き続きできる
    (`getOrCreateSession`の`allowEnded`)。終了後は新しい議論を勝手に始めない。
    **「学習者が自分で議論を終える」ボタンと、教師による手動終了は、今回は入れていない**
    (意図的に対象外にした。必要になれば`end_reason='student'`の枠は用意してある)。
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
    - **教師ダッシュボードの「指導のヒント」(2026-10)**: 「教師ダッシュボードでは、学習者の学びをどう
      ファシリテート・指導すればよいかをサジェストしてほしい」という要望。F14は数字を並べるだけで、
      F11(個別最適化)は「擬似メンバーの設定を変える」提案だったため、**教師自身の行動**(声かけ・
      問い・進め方)を提案する別機能にした(`src/lib/ai/teacher-guidance.ts`、`dashboard/actions.ts`の
      `generateTeacherGuidanceAction`、保存先`teacher_guidance`(授業ごと最新1件、`0036`))。
      授業全体の様子・次の授業でのファシリテーション(最大3つ)・次の活動/問い・個別に声をかけたい
      学習者(最大4人)を返す。**教師が押したときだけ生成**(AI呼び出しを自動化しない)。
      **AIには学習者の氏名を送らない**(「学習者A」の仮の呼び名で送り、`input.ts`の`mapIndividuals`/
      `restoreNames`でサーバー側で実名に戻して保存する。作り話の呼び名は捨てる)。対象は
      **データ利用に同意している学習者だけ**(撤回者・管理者のテスト学習者は除く)で、振り返りは
      「教師に共有」されたものの「迷ったこと」だけを使う。入力の集計(`src/lib/teacher-guidance/stats.ts`の
      `loadCourseStats`)はダッシュボード本体と共用。学習者が「自分のデータの全削除」をすると、関わった
      授業のヒントは丸ごと消える(個別の文だけを除くのが難しいため。再生成できる)。
      **提案にとどめ、最終判断は教師**(画面に明記)
    - **`[courseId]/flow/` 学習の流れ(インプットとアウトプットの設計、2026-10)**: 「動画や資料から
      インプットする時間と、アウトプットで学びを深める時間をコーディネートしたい」という要望。教師が
      授業ごとに、**インプット(動画・資料を見る)**と**アウトプット(擬似メンバーと議論)**のステップを
      自由に並べる(最大12個、上下で並べ替え、時間の目安つき、`course_steps`・`0037`)。ステップが1つも
      無い授業は従来どおり(議論だけ)。**インプット**は、動画URL(**埋め込まず、リンクとして新しいタブで開く**。利用者の要望。外部サイトを画面内に取り込まない。アップロードした動画ファイル(mp4/webm、20MBまで)は`<video>`で画面内再生。署名つきURLでSupabase Storageから直接配信し、VPSを通さない。`course_steps.video_path`、`0038`)と、資料(PDFは署名つきURLで画面内表示、それ以外は取り込み済みの本文を表示)、
      **理解チェック**の問い(資料の本文からAIが下書き、教師が編集。`ai/input-check.ts`)を持てる。
      学習者は自分の言葉で答え、「答えの目安」を開いて見比べる自己確認で、**AIは採点しない・学習時にAIを
      呼ばない**。進み具合は`step_progress`(インプットでは本人の答えも保存。全データ削除の対象)。
      **「順番どおりに進める」(`courses.steps_in_order`、既定オン)**では、インプットを終えるまで議論に入れない。
      この関門はサーバー側の議論の入口すべて(`dialogue.ts`の`postStudentMessageAndRespond`=テキスト・手書き・
      音声、`autoContinueDiscussionAction`)で`assertDiscussionAllowed`を通す(画面を迂回したAPI直叩きでも止まる。
      テストあり)。アウトプットの間は、そのステップの指示を擬似メンバーのプロンプトに添える(`stepContextFor`)。
      **この先にアウトプットが残っているうちは、AIは「まとめましょう」と議論の終了を急がない**(制限時間の
      提案は別)。議論のセッションは学習者ごとに1つなので、複数のアウトプットは同じ対話の続きになる。
      学習者の画面は、上部に進み具合(`flow-view.tsx`の`FlowStepper`)を出し、インプットは専用の画面
      (`InputStepView`)、アウトプットは従来のチャット画面(`OutputStepCard`の案内つき)。いまのステップと、
      終えたインプットの見直しだけ開ける(`canOpenStep`)。教師ダッシュボードの学習者の行に、ステップの
      進み具合を出す
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
    - **授業設定の拡張**(`courses/[courseId]/page.tsx`の「授業の設定」、`updateCourseSettingsAction`):
      「授業のねらい・議題」「学習者の校種・学年」「討論の型(対立型/協調型/教え合い型)」
      「AIメンバーの目標人数」(`courses.objective`/`learner_level`/`discussion_style`/
      `ai_member_count`、`0031_course_settings.sql`)。それまで授業に議題を入力する欄が無く、
      擬似メンバーは資料以外に何の授業かを知る手がかりが無かったため追加した。定義と、AIに渡す
      文脈の組み立ては`src/lib/courses/settings.ts`(純粋関数、テストあり)。**擬似メンバーの発言**
      (`persona.ts`の`courseContext`→システムプロンプトの「この授業について」)と、
      **AIによるペルソナ推薦**の両方に反映する。討論の型を協調型にしても、「根拠なく同調しない」
      共通ガードレールは変えない。「メンバー数」は**AI擬似メンバーの人数**の意味(学習者同士が
      同じ部屋で話す仕組みは無い。人間のグループ分けは別開発になるため今回は対象外)で、
      ペルソナ設定画面に、使用中の人数との差を表示する
    - `[courseId]/personas/` — F03(ペルソナ設定)+F04(教師による擬似メンバー設定)。
      **「AIにペルソナ案を作ってもらう」**(`recommendPersonaDraftsAction`、
      `src/lib/ai/persona-recommend.ts`): 授業設定と登録済み資料の抜粋から、互いに補い合う案を
      まとめて(または、人数1+ヒントで1体ずつ)作り、`tier='rag_initial', status='draft'`の
      **下書き**として保存する(教師が確認・修正して承認→使用中にする既存のF04の流れに乗せる。
      AIは使い始めない)。名前に「〜派の」のような接頭辞を付けない(利用者の明示の要望。
      `cleanPersonaName`でも取り除く)。授業あたり最大10体、1回最大5人分。
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
      一覧表示し、`updateTurnAction`で内容を修正できる。**修正は元の発言(`dialogue_turns.content`)を
      書き換えず、修正版を`dialogue_turn_corrections`に積む**(0042、生ログは書き換えない)。フラグと確認メモは
      これまでどおり`dialogue_turns`の`flagged_by_teacher`・`teacher_note`。画面の表示・以後の対話でLLMに渡す
      直近履歴・議論のまとめ・AIジャッジは、最新の修正版を使う(`src/lib/records/corrections.ts`の
      `applyTurnCorrections`。**発言の本文を表示したりAIに渡したりする新しい箇所では、これを通すこと**)ので、
      訂正すれば同じ誤りの再発も防げる。監査画面では元の発言も確認できる
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
- `src/lib/learn/dialogue.ts` — F05の対話の中核(`postStudentMessageAndRespond`・
  `getOrCreateSession`・`pickRespondingPersona`)。`learn/[courseId]/actions.ts`と、
  ストリーミングAPI(`app/api/learn/[courseId]/message/route.ts`、テストあり)から共用する
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
  - `0044_inquiry_groups.sql` — **探究シリーズと人間のグループ**。`course_series.kind`(standard/inquiry)、グループの参加コード
    (`inquiry_projects.join_code`)、メンバーの脱退(`inquiry_project_members.left_at`)、テーマの変更履歴(`inquiry_theme_changes`)、
    発言者(`dialogue_turns.author_student_id`、既存の個人の議論は埋め戻し)、グループの議論は授業回×グループで1つ(部分一意索引)。
    下の「探究シリーズと人間のグループ」を参照
  - `0043_extraction_layer.sql` — **②抽出層**(要件定義書14章の実装(2a))。AIの使用量の記録(`ai_usage_log`、合計用の関数
    `ai_usage_cost_since`/`ai_usage_summary_since`)、段階(`courses.expected_stage_key`・`inquiry_projects.current_stage_key`・
    `inquiry_stage_transitions`)、印(`inquiry_markers`)、処理待ち(`inquiry_jobs`)、軌跡・段階の物語・エピソードとその版・出典
    (`inquiry_trajectories`/`inquiry_stage_stories`/`inquiry_episodes`/`inquiry_episode_versions`/`inquiry_sources`)。下の「②抽出層」を参照
  - `0042_raw_log_protection.sql` — **生ログの保護**(要件定義書14章のPart A)。探究プロジェクト(`inquiry_projects`/`inquiry_project_members`)、
    記録の「授業の控え」(`course_label`ほか)、授業回・シリーズ・擬似メンバー・ステップを消しても記録が残る削除ルール(set null)、
    発言の修正版(`dialogue_turn_corrections`)。既存の記録への控えの埋め戻しと、個人プロジェクトへの束ねも含む(下の「生ログの保護」を参照)
  - `0041_revoke_public_api_access.sql` — 公開API(anon/authenticated)の権限を外す(RLSの二重の防壁。詳細は「認証まわりの注意」)
  - `0040_series_management.sql` — `course_series.planned_lessons`(全回数)・`fiscal_year`(年度)・`archived_at`(アーカイブ)
  - `0039_course_series.sql` — 授業シリーズ(`course_series`)・`series_enrollments`・`courses.series_id/lesson_no/released`。既存の授業は同名シリーズの第1回に移し、`course_enrollments`・`courses.join_code`は廃止
  - `0038_step_video_file.sql` — インプットのステップに動画ファイル(`course_steps.video_path`)
  - `0037_learning_flow.sql` — 学習の流れ。`course_steps`(インプット/アウトプットのステップ)・`step_progress`・`courses.steps_in_order`
  - `0036_teacher_guidance.sql` — 教師ダッシュボードの「指導のヒント」(`teacher_guidance`、授業ごと最新1件)
  - `0035_portfolio.sql` — ポートフォリオ。`portfolio_entries`に`submission_id`・`shared`・`updated_at`、`portfolio_share_links`(詳細は`learn/portfolio/`)
  - `0034_reasoning_depth.sql` — 擬似メンバーの発言を作るAIの推論の深さ(`courses.reasoning_depth`)
  - `0033_discussion_liveliness.sql` — 擬似メンバーの発言の活発さ(`courses.discussion_liveliness`)
  - `0032_session_end.sql` — 議論の「終わり」。`courses.time_limit_minutes`/`time_limit_policy`/
    `time_limit_affects_evaluation`/`ai_close_suggestion`、`learning_sessions.end_reason`/
    `closing_summary`/`close_suggested_at`/`close_suggestion_reason`/`close_suggest_after_turn`
  - `0031_course_settings.sql` — 授業設定の拡張。`courses.objective`(ねらい・議題)/
    `learner_level`(校種・学年)/`discussion_style`(討論の型)/`ai_member_count`(AIメンバーの目標人数)
  - `0030_test_student.sql` — 管理者の「学習者として表示」用。`profiles.test_owner_id`
    (その管理者専用のテスト学習者、1人につき1つ)を追加(詳細は8章の`signup/`の近くの説明を参照)
  - `0029_signup_approval.sql` — 自己登録の承認制。`profiles.approval_status`(`pending`/
    `approved`/`rejected`、既定`approved`)・`profiles.is_admin`、`course_enrollments.status`
    (`pending`/`approved`、既存の登録は承認済み扱い)を追加(詳細は8章の`signup/`の説明を参照)
  - `0035_portfolio.sql` — ポートフォリオ。`portfolio_entries`に`submission_id`(成果1件1行)・`shared`・
    `updated_at`を追加し、公開リンク`portfolio_share_links`を追加(詳細は8章の`learn/portfolio/`を参照)
- `scripts/stage0/` — 段階0の使い捨てプロトタイプ(`debate_experiment.py`)。
  ペルソナ対話と論証評価の「質感」を、画面なしでローカル検証するためのCLIスクリプト。
  段階1のNext.js実装に置き換わる前提の使い捨てコード。
- `scripts/dev/create-user.mjs` — 開発用: テストアカウント(教師/生徒)を作成するスクリプト。
  サインアップ画面はまだないため、当面はこれでアカウントを作る
  (`node --env-file=.env.local scripts/dev/create-user.mjs --email ... --password ... --role teacher`)。
- `scripts/dev/generate-lti-keys.mjs` — F17用: このツール自身のRSA署名鍵ペア(PKCS8 PEM)を
  生成し、`.env.local`に貼り付ける`LTI_TOOL_PRIVATE_KEY`/`LTI_TOOL_KEY_ID`を出力する
  (`node scripts/dev/generate-lti-keys.mjs`)。

### 授業シリーズと授業回の階層(2026-10)

「担当・履修する授業シリーズの登録と、各授業回の学習という階層が無い」という指摘を受けて追加した。
**授業シリーズ(`course_series`、科目・講座)→ 授業回(`courses`、第1回・第2回…)**の2段にし、
**履修(授業コード・申請・承認・直接登録、`series_enrollments`)だけをシリーズに持たせ、資料・ペルソナ・評価の観点・
学習の流れ・議論・提出は、すべて授業回(`courses`)ごと**に持つ(利用者の判断。ペルソナ等を回ごとに作る分、設定の
やり直しは要るが、回ごとに内容を変えやすい)。`courses`テーブルは「授業回」として使い、`series_id`・`lesson_no`
(シリーズ内で一意)・`released`(公開済みか)を足した(`0039`。**授業シリーズ配下の授業回を指すときも、コード上の
名前は`courseId`/`courses`のまま**)。`courses.owner_teacher_id`はシリーズの担当教師と同じ値で、所有者チェック
(`assertOwnsCourse`)はこれまでどおり。シリーズ側は`assertOwnsSeries`(`src/lib/courses/series.ts`)。
既存の授業は、同名のシリーズの「第1回(公開済み)」に自動で移した(参加コード・履修・記録はそのまま)。

- **画面**: 教師は`/courses`=授業シリーズ一覧(作成)→`/series/[seriesId]`=授業回の一覧・作成(第N回、新しい回は
  「準備中」)と履修登録(授業コード・承認待ち・直接登録)→`/courses/[courseId]`=授業回(ここで「学習者に公開する」。
  公開するまで学習者には見えない)。学習者は`/learn`=履修中のシリーズ→`/learn/series/[seriesId]`=公開済みの
  授業回の一覧(進み具合)→`/learn/[courseId]`=授業回の学習。ヘッダーの「授業シリーズ」は`/series`配下でも強調する
  (`NavItem.alsoUnder`)。授業回の画面のパンくずは`loadLessonCrumbs`(「授業シリーズ一覧 › シリーズ › 第N回」)、
  一覧や記録で回を名指すときは`loadLessonLabels`(「シリーズ名 第N回 名前」)を使うこと。
- **ガード**: `isEnrolled`/`requireEnrollment`(`src/lib/courses/enrollment.ts`)は、授業回→シリーズの**承認済みの
  履修**と、回が**公開済み**であることを確かめる(管理者の「学習者として表示」のテスト学習者だけは、公開前の回も
  確認できる)。授業コードはシリーズのもの(`course_series.join_code`)。LTI経由の自動登録もシリーズに作る。
- 旧`course_enrollments`と`courses.join_code`は廃止した(上の「`learn/`」の説明にある受講登録の記述は、今は
  シリーズ単位として読み替えること)。

#### 前の回からの複製(擬似メンバー・評価の観点、2026-10)

回ごとに設定を持つ設計のため、回を重ねるたびの作り直しを減らす。`src/lib/courses/lesson-copy.ts`:
- **擬似メンバー**(`copyPersonasBetweenLessons`): 同じシリーズの別の授業回から、**状態(使用中など)・アバターもそのまま**複製する
  (「同じメンバーで続ける」ため)。共有ライブラリへの公開は引き継がない。**同じ名前が複製先にあれば複製しない**(何度押しても増えない)。
  1授業回の上限(10体)を超えない。複製元の回名を`origin_note`に残す。
- **評価の観点**(`copyCriteriaBetweenLessons`): 同じ名前の観点を除いて複製し、複製先の末尾の順番に並べる。
- **同じシリーズの授業回どうしだけ**(別シリーズからは複製しない。シリーズをまたぐ共有は共有ライブラリ(F21))。複製元・複製先の
  両方が自分の授業回であることを確かめる(`lesson-copy-actions.ts`)。
- 使う場所: ペルソナ設定・評価の観点の各画面の「前の回から複製する」(複製元は、既定で直前の回を選ぶ。結果は`?copied=&skipped=`で表示)と、
  **授業回の作成時の「前の回の擬似メンバーと評価の観点を引き継ぐ」(既定オン)**。
- 資料・学習の流れ・議題は、この機能では複製しない(回ごとに内容が変わるため。年度をまたぐ引き継ぎ(`carryOverSeries`)では複製する)。

#### 授業シリーズの管理(全回数・年度・アーカイブ・削除、2026-10)

「授業名(全◯回)/第1回、第2回…の形にしたい。一覧から削除や年次処理ができるように」という要望(`0040`)。
- **全◯回**(`course_series.planned_lessons`、任意): **表示用の予定回数**(「理科1年 光合成(全8回)」「作成済み 3/8回」)。
  回は自動では作らず、先生が1つずつ作る(超えても作れる)。`seriesLabel()`で表示名を作る。
- **年度**(`fiscal_year`、4月始まり・日本時間。既存は作成日から算出): 一覧を年度で絞り込む。
- **アーカイブ**(`archived_at`): 年度末などにシリーズを閉じる。**新しい履修登録(授業コード・サインアップ)・発言・提出・
  インプットの完了を受け付けない**(サーバー側は`getOrCreateSessionRow`・`completeStepAction`・参加申請で
  `isLessonArchived`/`ARCHIVED_MESSAGE`を確かめる。画面は入力欄・提出フォームを隠す)。学習者は「過去のシリーズ」
  として記録を見返せる。いつでも解除できる。一覧の「年度末の一括アーカイブ」で、年度ごとにまとめて閉じられる。
- **削除**(`series-admin.ts`の`deleteSeries`、0042以降): **授業の構成**(授業回・資料・擬似メンバー・評価の観点・
  学習の流れ)を、資料・動画ファイルのStorageごと完全に削除する。**学習者の記録(対話・提出・振り返り・進み・手書き画像・
  音声)は消えず**、授業の控え(`course_label`)と探究プロジェクトを持ったまま学習者のポートフォリオに残る。記録がある
  ときは、0042がDBに入っていることを確かめ(`assertRawLogProtection`。入っていないDBで消すと記録が連鎖で消えるため)、
  控えの抜けを埋めてから(`stampSeriesRecordContext`)消す。以前は「記録が無いシリーズだけ削除できる」(`deleteSeriesIfEmpty`)だった。
- **強制削除=「テストデータの消去」**(`forceDeleteSeries`、**管理者のみ**。一般の教師は、学習者の記録を消せない): 学習者の記録がある
  シリーズを、**記録ごと完全に削除**する(元に戻せない。学習者の
  ポートフォリオからも消える)。導入初期のテストデータを片付けるための機能で、本物の学習者の記録には使わない。誤操作を防ぐため、**(1)先にアーカイブしてあること、(2)シリーズ名を一字一句入力すること**を
  サーバー側で求め、画面には消える記録の量(学習者数・対話・提出物)を見せる。0042以降は授業の構成を消しても記録は
  連鎖では消えないため、`deleteLearnerRecords`が記録を**明示的に**消す(対話ログ → ポートフォリオの記録 → 成果 →
  セッション → 進み・学習計画 → 探究プロジェクト(記録が参照しているので最後)。順序はテストで固定している)。手書き画像・音声・資料・動画の
  Storageのファイルも消す(`collectSeriesFiles`)。ただし、F26の横断プロファイル(`learner_profiles`)など、消えた記録から
  作られた要約は残る。
- **翌年度への引き継ぎ**(`carryOverSeries`): 授業回・資料(ファイルも複製、RAGは複製先で再生成)・擬似メンバー
  (**学習進化型は除く**。特定年度の学習者の記録から作られているため)・評価の観点・学習の流れ(資料は複製先に付け替え、
  動画ファイルも複製)を、新しい年度のシリーズに複製する。授業回は「準備中」。**履修者・学習者の記録は引き継がず、
  授業コードは新しくなる**。途中で失敗したら、新しいシリーズごと消して巻き戻す。
- **履修者の一括整理**: 承認済みの履修者を別のシリーズにも登録する/履修登録を全員分外す(学習者の記録は消えない)。
- 管理は、`/courses`(一覧の「管理」)と`/series/[seriesId]`(「3. 年度の処理・シリーズの管理」)のどちらからもできる。

### 生ログの保護(0042、要件定義書14章のPart A、2026-10-21)

要件定義書14章「データ基盤の再設計(3層)」の①記録層を、授業から独立させた。**学習者の記録は、授業回・シリーズ・
擬似メンバー・ステップ(授業の構成)を消しても消えない**。記録ごと消えるのは、学習者本人の全データ削除(F16)と、
管理者の「テストデータの消去」だけ(どちらもアプリが明示的に消す)。

- **探究プロジェクト**(`inquiry_projects`/`inquiry_project_members`): 記録をまとめる、授業から独立した単位。
  いまは人間のグループが無いので、すべて「学習者 × シリーズ」の**個人プロジェクト**(`kind='solo'`、`solo_student_id`、
  (シリーズ, 本人)で一意)。シリーズが消えても残る(`series_label`が控え)。
- **授業の控え**: `learning_sessions`/`submissions`/`step_progress`の`course_label`(「シリーズ名 第N回 名前」)、
  `step_progress`の`step_title`/`step_kind`、`dialogue_turns`の`persona_name`。授業回が消えると`course_id`等は null になり、
  控えで文脈を表示する(ポートフォリオ・学習ダッシュボード・F26の材料)。
- **新しい記録を作るときは、文脈を一緒に書く**: セッション・成果は`src/lib/records/context.ts`の`recordContextFor`
  (`project_id`と`course_label`)、インプットの進みは`loadLessonContext`の`label`、擬似メンバーの発言は`persona_name`。
  **①のテーブルに行を足す新しいコードでは、これらを必ず書くこと**(書き忘れても、シリーズ削除の前に
  `stampSeriesRecordContext`が埋めるが、それに頼らない)。
- **発言の修正版**: 上の「`[courseId]/audit/`」を参照。
- 記録を読むコードは、`course_id`が null の行がありうることを前提にする(`.in("course_id", …)`に null を混ぜない、
  表示は`course_label`にフォールバックする)。
- ②抽出層は`0043`、探究のグループは`0044`で入れた(次の節)。残り(③投射層のテーブル、F26・ペルソナの版1の移し替え)は、実装(2b)の`0045`で入れる予定。

### ②抽出層とAIの使用量(0043、要件定義書14章の実装(2a)、2026-10-21)

要件定義書14章ステップ5・6の決定に沿って、①の記録から「後輩の参考になる記録」を作る。**③(先輩型・他校型ペルソナ、
検索、貸し出し)はまだ無い**ので、いまは作るだけで、対話には使っていない(実装(2b))。

- **AIの使用量**(`src/lib/ai/usage.ts`): `openai.ts`のクライアントが、`responses.parse/create/stream`と`embeddings.create`の
  結果から実際のトークン数を取り、`ai_usage_log`に自動で記録する(呼び出し側の変更は不要。記録の失敗は呼び出しを止めない)。
  用途は構造化出力の名前(`zodTextFormat`の第2引数)から自動で付く。授業回・用途を明示するときは`withAiContext()`で囲む。
  金額は`PRICES_PER_MILLION_USD`(公開価格からの目安。**モデルや価格が変わったらここを直す**)。月の上限は環境変数
  `SYNCLIE_MONTHLY_AI_BUDGET_USD`(未設定なら上限なし)で、超えると抽出を「後回し」にする(対話は止めない)。
- **印**(`src/lib/inquiry/markers.ts`、AIなし): 論証評価で新しい根拠あり(`evidence_shift`)・根拠を受けて擬似メンバーが譲歩
  (`persona_conceded`)は`dialogue.ts`が自動で付ける。学習者の「☆ 後輩に残す」(`toggleKeepForJuniorsAction`、本人の議論の発言だけ。
  境界は`loadOwnTurnSession`でテスト済み)、教師の印(発言の監査画面のチェック)。
- **段階**(`src/lib/inquiry/stages.ts`・`project-stage.ts`): 既定の4段階。授業回の「この回で想定する探究の段階」(授業の設定)が
  いまより先なら、その回の議論を始めたときに進める(自動では戻さない)。学習者は授業回の画面の「段階を変える」で宣言できる
  (`declareStageAction`)。切り替えは`inquiry_stage_transitions`に残る。
- **処理待ちと後処理**(`src/lib/inquiry/queue.ts`): きっかけで`inquiry_jobs`に積み、そのリクエストの`after()`で実行する
  (**cronは作らない**)。二重に積まない(`dedupe_key`)・取り合わない(pending→runningを取れた方だけが処理)。失敗・後回しは
  教師ダッシュボードの「探究の記録づくり」で件数を出し、「やり直す」で再実行する(`retryInquiryJobsAction`)。
  **プロンプトを改良したら`PROMPT_VERSIONS`を上げる**(同じ対象を新しい版として処理し直せる。古い版は消さない)。
- **作るもの**(`src/lib/inquiry/pipeline.ts`、AIは`MODEL_JUDGE`):
  (1)**議論の終了**(`close.ts`)→`extract_session`: 印の付いた場面から、エピソード(最大3件)を**1回の呼び出し**で作る
  (`src/lib/ai/episode-extraction.ts`)。**印が無い議論ではAIを呼ばない**。原文の抜粋はAIに書かせず発言から切り出し、語り
  (一人称・その議論より後のことは書かない・400字まで)は名簿の名前を機械的に伏せる(`anonymize.ts`)。出典は`inquiry_sources`。
  (2)**段階の切り替え**→`build_stage_story`: 終わった段階のエピソードから、段階の物語(当時版)と軌跡の新しい版(800字まで)を
  1回で作る(`src/lib/ai/stage-story.ts`)。(3)**シリーズのアーカイブ**(=探究の終了)→最後の段階の物語と、振り返り版。
  対象は、データ利用に同意している学習者だけ(管理者のテスト学習者は除く)。
- **消え方**: エピソードは元の対話セッション、段階の物語・軌跡はプロジェクトに連鎖する。学習者本人の全データ削除と、管理者の
  テストデータの消去では消え、教師の通常の削除では残る(実DBで確認済み)。`ai_usage_log`は学習者の内容を持たないので残る。
- 後から印が付いた議論(終了後の「後輩に残す」・教師の印)は、`round`を変えてもう一度積み、すでにエピソードにした範囲は重ねない。

### 探究シリーズと人間のグループ(0044、2026-10-21)

「今のSynclieの中に探究を加える」(先生の判断)。授業シリーズを作るときに**学び方「探究」**を選ぶと(作成後は変えない)、
そのシリーズの授業回の議論は**学習者のグループで1つ**になる。決定: 議論は**時間差(非同期)が基本**、グループは**教師の割り当てと
生徒のコード参加の両方**、テーマは**グループが決めて更新し、変更の履歴を残す**。

- **どの議論か**(`src/lib/learn/session-scope.ts`): `resolveSessionScope`が solo(本人の議論)/ group(グループの共有の議論。
  `learning_sessions.student_id`は null、`project_id`がグループ)/ needs_group(探究でグループ未所属=議論できない)を返す。
  **議論を探す・作るコードは、`student_id = 本人`で直接絞らず、`scopeSessionQuery`を通すこと**(グループの議論が見えなくなる)。
  発言には必ず`author_student_id`を書く(`dialogue.ts`)。**学習者ごとの集計は、セッションの`student_id`ではなく発言の
  `author_student_id`で数える**(教師ダッシュボード`stats.ts`・学習ダッシュボード・学習進化型ペルソナの材料・シリーズの記録の量)。
- **AIには氏名を送らない**: グループの発言は「メンバーA・B…」(参加した順、`memberAlias`)としてAIに渡す。擬似メンバーには、
  グループで時間差で議論していることと、グループが決めたテーマを伝える(テーマは擬似メンバーが変えない)。
- **グループの決まり**(`src/lib/inquiry/groups.ts`、テストあり): 入れるのはシリーズの承認済みの履修者だけ、1シリーズ1グループ
  (別のグループに入ると前のグループから抜ける)、抜けても行は消さない(`left_at`)、アーカイブしたシリーズでは変更不可、
  テーマを変えられるのはメンバーだけ(変わったときだけ履歴を残す)、記録のあるグループは消せない。履修登録を外すと、
  そのシリーズのグループからも抜ける(`leaveSeriesGroups`)。
- **画面**: 教師は`/series/[seriesId]`の「グループ」(`groups-section.tsx`・`group-actions.ts`。作成・割り当て・外す・コードの再発行・
  名前の変更・テーマの変化)。学習者は`/learn/series/[seriesId]`の「あなたのグループ」(コードで入る・抜ける・テーマを決める/更新。
  `actions.ts`)。授業回の画面は、他のメンバーの発言を名前つきで左に出し、15秒ごとに新しい発言を確かめる
  (`group-live-refresh.tsx`・`/api/learn/[courseId]/turn-count`、画面が見えている間だけ)。沈黙時の自動継続はグループでは使わない。
  議論のまとめ(終了)はメンバーの誰でもできる。成果の提出・振り返りは、これまでどおり一人ずつ。
- **②抽出層**: グループの議論は、**発言したメンバーごとに同意を確かめ、同意していない人の発言はAIにも材料にも使わない**。
  名前の伏せ字は、メンバー全員と担当教師の名前。
- **本人の全データ削除(F16)**(`src/lib/inquiry/forget.ts`): グループの議論は消さず、**本人の発言だけ**を消す(手書き・音声の
  ファイルも)。本人の発言があった議論のエピソードと、そのグループの段階の物語・軌跡も消し、残ったメンバーの記録から作り直す仕事を
  積む(エピソードは元の段階に置く。`extract_session`の`stage_key`)。テーマの履歴の変更者の印も外す。

### 画面の文章と「流れ」の見せ方(2026-10)

- **画面の文章に、機能番号(F01〜F26)を出さない**(利用者には意味が無い。コメントや本ファイルでは使ってよい)。
  説明文は1〜2文を目安に、長い仕様の説明は書かない(必要なら`<details>`に畳む)。
- **順番のある操作(流れ)には、`<StepNumber n={…}/>`(`src/components/step-number.tsx`)で番号を付けて、
  実際の順に並べる**。例: 授業の準備(1授業の設定→2資料→3ペルソナ→4学習の流れ→5評価の観点)、学習者の
  提出後(1AIフィードバック→2AIジャッジ→3振り返り。結果の表示もこの順)、ペルソナの状態(1下書き→
  2承認済み→3使用中。いまの段階を強調し、次のボタンは「次へ: …」)。任意の操作には「任意」と書く。
- 学習ダッシュボードの先頭に、ポートフォリオの要約(`portfolio/summary.ts`: 成果・先生のコメント・
  自己評価がまだ・公開用の件数と最新3件)を出す。

### 画面の階層と「戻る」の設計(2026-10)

「並列に並びすぎて見づらい、親子関係があるのに並列、『〜に戻る』が無くて不便」という指摘を受けて
整理した。**新しい画面を足すときは、次のルールに従うこと。**

- **画面の親子関係**(この木に沿って、パンくずと「戻る」を付ける):
  教師 `授業一覧(/courses)` → `授業(/courses/[id])` → `ペルソナ設定` → `ペルソナ詳細` /
  `評価の観点` → `観点の編集` / `ダッシュボード`・`提出物`・`学習者プロファイル`・`同調の計測`・`発言の監査`。
  `組織`・`共有ライブラリ`・`教師の承認(管理者)`は「授業一覧」と並ぶ上位のページ。
  学習者 `授業一覧(/learn)` → `授業(/learn/[id])` → `ポートフォリオ`。`学習ダッシュボード`・
  `自分のデータ`・`授業に参加`は「授業一覧」と並ぶ上位のページ。
- **上位のページ同士の移動は、画面上部の共通メニュー**(`src/components/header-nav.tsx`、役割ごとの
  項目は`layout.tsx`の`NAV_ITEMS`)に集約する。各画面にリンクの行を散らさない。現在地は、一番長く
  一致した項目だけを強調する(`getActiveHref`)。「学習者として表示」中は学習者用のメニューにする。
- **全画面に`<Breadcrumbs trail current />`**(`src/components/breadcrumbs.tsx`)を置く。左に
  「← 直接の親に戻る」、続けて祖先をたどるパンくず。**長い画面の最後には`<BackLink />`**も置く
  (最後まで読んだあとに上まで戻らなくてよいように)。「戻る」の文言・位置は、この部品で統一する。
- **授業の管理画面(`courses/[courseId]/page.tsx`)は3段構成**: 「1. 授業を準備する」(授業の設定・
  資料・ペルソナ設定・評価の観点)→「2. 学習者を迎える」(受講登録・テンポ)→「3. 学習の様子を
  確認する」(ダッシュボード等)。重いフォームは`<details>`で折りたたみ、見出しに状況(参加人数、
  資料の件数など)を添える。作成フォームのような「たまにしか使わない」ものは折りたたみにして、
  一覧(よく見るもの)を上に置く(`courses/page.tsx`・`personas/page.tsx`)。

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

- **公開API(PostgRESTのanon/authenticated)からは、何も読み書きできない**ようにしてある(2026-10-21、`0041`)。
  全テーブルでRLSを有効にしてポリシーは置かず(=全拒否)、さらに`0041`で**anon/authenticatedの権限そのものを外し**
  (既定の権限も外す)、授業RAGの検索関数`match_material_chunks`も`service_role`だけに実行を絞った。Supabaseは新しい
  テーブルに既定で全権限を付けるため、RLSの有効化を忘れても漏れないようにするための二重の防壁。
  **行ごとのRLSポリシー(「この教師はこの授業だけ」)は、書けない**: 利用者がSupabase Authの利用者ではなく
  (認証はAuth.js)、`auth.uid()`で本人を特定できないため。アクセスの制御は、アプリ側の`requireRole`・`assertOwnsCourse`・
  `requireEnrollment`などで行い、DBへは常に`service_role`(`createAdminClient()`)で接続する。
  **確認**: `node --env-file=.env.local scripts/dev/check-public-access.mjs`(本番は`.env.production.local`)が
  すべてPASSになること。テーブルを足したら実行する。
  **新しいテーブルを追加するたびに、そのマイグレーションで`alter table ... enable row level security;`も必ず一緒に実行すること**
  (権限は`0041`の既定で外れるが、二重にする)。**新しい関数を足すときは、`revoke all on function ... from public, anon,
  authenticated; grant execute ... to service_role;`も付ける**(関数の実行権限は既定で全員に付くため)。
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
