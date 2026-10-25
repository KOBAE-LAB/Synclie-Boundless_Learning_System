# 使い方ガイド動画の作り方

トップ画面の「使い方ガイド(動画)」(`/guide`)の4本の動画を作るスクリプト。画面は**開発DBのデモ用データ**を
Playwright(Chrome)で撮り、日本語のナレーション(**Open JTalk の音声モデル「Mei」**。Concept Design Note の動画と同じ声・同じ設定)を付けて`ffmpeg`でMP4にする。字幕は、映像の下に黒い帯を足して**焼き付ける**(常に見える。iPhoneのSafariなどでは、オン・オフの字幕が標準で出ないため)。WebVTT(`*.ja.vtt`)も作るが、二重表示を避けるため、ページでは標準でオフ。

- `spec.mjs` — 台本(場面ごとの画面・強調・ナレーション)と、読み上げ用の読み(`reading`)。**読み間違いはここで直す**
- `build.mjs` — `node build.mjs shots [slug]`(画面を撮る)/`video [slug]`(音声→MP4→字幕→`public/guide/`と`src/app/guide/videos.json`)
  - 一部の画面だけ撮り直す: `IDS=t08,s06 node build.mjs shots`
- `lib.mjs` — ログインして画面を開く補助。`.work/demo-accounts.txt`(`teacher メール パスワード`の行。`student`/`student2`も)を読む
- `seed-standard.mjs` / `seed-inquiry.mjs` — AIを呼べない環境でも、議論・成果・フィードバック等のデモ記録を入れる

## 準備(初回)
0. `brew install open-jtalk`(辞書と Mei が入っている。置き場所は環境変数 `GUIDE_JTALK_PREFIX` / `GUIDE_DIC` / `GUIDE_VOICE` で変えられる)。音声のクレジット(CC BY 3.0)は、`/guide` ページに載せてある。
1. `npm i --prefix scripts/guide-video playwright-core`(リポジトリ本体には入れない)。Google Chromeが必要
2. 開発サーバー(`npm run dev`)を起動し、デモ用の教師・学習者アカウントを`scripts/dev/create-user.mjs`で作り、`.work/demo-accounts.txt`に書く
3. 教科・科目(教科・科目学習モード「理科 光合成のしくみ」/探究学習モード「総合的な探究 島の未来を考える」)・授業回・資料・擬似メンバー・
   学習の流れ・評価の観点・グループを、画面から作る。IDは`spec.mjs`の先頭のものに合わせる(作り直したら書き換える)
4. `seed-standard.mjs` → `seed-inquiry.mjs` → `seed-senior.mjs`(先輩型・前年度の記録。デモの先輩アカウントが要る)を`node --env-file=.env.local`で実行する

## 注意
- 動画に映る画面は**デモ用のデータ**。本物の学習者の記録・氏名を映さない
- 画面の仕様が変わったら、`spec.mjs`のナレーションと画面を見直して撮り直す
- 開発サーバーは、撮影中にソースを編集すると固まることがある(再起動する)
