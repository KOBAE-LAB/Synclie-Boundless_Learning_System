# Synclie - Boundless Learning System

オンデマンド学習をインタラクティブに、独習を個別最適に。
教師がアップロードした教材をRAGで参照する「AI擬似メンバー(ペルソナ)」と学習者が
協働・討論することで、安易な同調を避けながら思考を深める学習支援アプリです。

開発の詳細な経緯・設計判断は要件定義書を参照してください:
https://claude.ai/code/artifact/6ed10ac9-6621-41e4-99b9-f25ad7d9cc7f

開発時の早見表は [`CLAUDE.md`](./CLAUDE.md) を参照してください。

## セットアップ

```bash
npm install
cp .env.example .env.local  # 値を設定する
```

Supabaseプロジェクトに `supabase/migrations/` 配下のSQLを順番に適用してください
(Supabase CLIの `supabase db push`、またはSQL Editorに貼り付けて実行)。

テスト用の教師アカウントを作成します(サインアップ画面はまだないため):

```bash
node --env-file=.env.local scripts/dev/create-user.mjs \
  --email teacher@example.com --password test1234 --role teacher --name "テスト教師"
```

```bash
npm run dev
```

[http://localhost:3000/login](http://localhost:3000/login) からログインし、`/courses` で授業・資料を登録できます。

## さくらVPSへのデプロイ(暫定)

当面はさくらVPS上でNext.jsを常駐させて動かします(DB・Storageは引き続きSupabase)。
設定ファイルのひな形は [`deploy/`](./deploy) にあります。**実際のVPSでの動作は未検証です**
(実機で確認したら更新してください)。

| ファイル | 内容 |
| --- | --- |
| `deploy/synclie.service` | systemdユニット(`/etc/systemd/system/`へ置く。127.0.0.1:3000で待ち受け) |
| `deploy/nginx-synclie.conf` | nginxのリバースプロキシ+HTTPS設定(`YOUR_DOMAIN`を置換) |
| `deploy/deploy.sh` | VPS上での更新(git取得→`npm ci`→build→再起動) |

初回の手順:

1. VPSにNode.js 22以上・nginx・gitを入れ、専用ユーザー(例: `synclie`)で
   リポジトリを `/opt/synclie` に配置する
2. `/opt/synclie/.env.local` に `.env.example` の値を設定する。`NEXTAUTH_URL`・
   `LTI_TOOL_BASE_URL` は公開URL(`https://...`)にし、`AUTH_TRUST_HOST=true` も入れる
3. `deploy/synclie.service` を `/etc/systemd/system/` に置き、
   `systemctl enable --now synclie` で常駐させる
4. `deploy/nginx-synclie.conf` を配置し、certbotでLet's Encrypt証明書を発行してHTTPS化する
5. DBマイグレーションはVPSではなく手元から `supabase db push` で適用する
   (VPSにSupabase CLIの認証を置く必要はない)

更新時は VPS 上で `./deploy/deploy.sh` を実行します。

注意点:

- **リバースプロキシ配下のAuth.js**: `AUTH_TRUST_HOST=true` が無いと `UntrustedHost` でログインできない。
  また、サーバーアクションはOriginとHostの一致を検査するため、nginxで `Host` を転送すること
  (ひな形は転送済み)
- **アップロード上限**: `next.config.ts` の `serverActions.bodySizeLimit` と nginx の
  `client_max_body_size` は同じ値(現在25MB)に揃えること
- **可用性**: VPSは単一サーバーのため、プロセス監視(`Restart=always`済み)・OSの更新・
  バックアップは自前で行う
- **Supabaseの無料枠**: プロジェクトが一時停止(INACTIVE)になっていると、アプリは動かない

## 技術スタック(段階1)

- Next.js (TypeScript, App Router)
- Supabase (Postgres + pgvector)
- Auth.js (NextAuth v5) — 段階1: 簡易ログイン / 段階2: SSO(Microsoft Entra ID, Google Workspace for Education)
- OpenAI API(ペルソナ対話・論証評価)

## ディレクトリ構成

- `src/app/` — ページ・APIルート(`login/` ログイン, `courses/` F01 授業・資料登録)
- `src/lib/supabase/` — Supabaseクライアント
- `src/lib/ai/` — ペルソナ対話・論証評価ロジック
- `src/lib/auth/` — パスワードハッシュ・ロール確認ヘルパー
- `supabase/migrations/` — DBスキーマ
- `scripts/stage0/` — 段階0の使い捨てプロトタイプ(Python CLI)
- `scripts/dev/` — 開発用スクリプト(テストアカウント作成など)

## 段階0プロトタイプ(参考)

画面を作る前に、ペルソナ対話と論証評価の「質感」をローカルで確認するための
使い捨てスクリプトです。

```bash
cd scripts/stage0
pip install -r requirements.txt
export OPENAI_API_KEY=...
python debate_experiment.py
```
