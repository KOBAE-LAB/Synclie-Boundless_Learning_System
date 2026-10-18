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

最初の教師アカウント(管理者)を作成します。教師の自己登録は管理者の承認制のため、
管理者(`--admin true`)が最低1人必要です:

```bash
node --env-file=.env.local scripts/dev/create-user.mjs \
  --email you@example.com --password "10文字以上の強いパスワード" --role teacher --name "管理者" --admin true
```

```bash
npm run dev
```

[http://localhost:3000/login](http://localhost:3000/login) からログインし、`/courses` で授業・資料を登録できます。

## さくらVPSへのデプロイ(暫定)

公開URL: https://synclie-boundless-learning-system.kobae-lab.com/ (2026-10-19に公開。
DB・StorageはSupabase、アプリだけがさくらVPS上のNext.js)。

このVPS(Ubuntu、メモリ1GB)は他のアプリ(`synclie-share`、`tech-integration`)と同居している。
そのため **ビルドはVPS上では行わず、手元のMacでビルドしてアップロードする**。
ポートは3007、`synclie-bls.service`(systemd、`MemoryMax=450M`)で常駐、nginxがHTTPSを終端する。

| ファイル | 内容 |
| --- | --- |
| `deploy/deploy.sh` | 手元で実行する更新スクリプト(ビルド→rsync→`npm ci --omit=dev`) |
| `deploy/setup-vps.sh` | VPS上で1回だけ実行する初期設定(systemd・nginx・HTTPS証明書) |
| `deploy/synclie-bls.service` | systemdユニット |

アプリの置き場所は `/home/ubuntu/apps/synclie-bls`、本番の環境変数は同ディレクトリの
`.env.local`(`NEXTAUTH_URL`/`AUTH_URL`は公開URL、`AUTH_TRUST_HOST=true`、`AUTH_SECRET`は
開発用とは別の値)。

更新手順(コード変更後):

```bash
./deploy/deploy.sh                      # 手元で。ビルドしてVPSへ送る
ssh -i ~/.ssh/kobae_lab_apps ubuntu@49.212.150.72
sudo systemctl restart synclie-bls      # VPS上で(sudoのパスワードが要るため手動)
```

DBマイグレーションはVPSではなく手元から `supabase db push` で適用する。

注意点:

- **開発と本番が同じSupabaseを共有している**(プロジェクトを分けていない)。開発用のテスト
  アカウントも本番から見えるため、公開して使う前に整理すること
- **リバースプロキシ配下のAuth.js**: `AUTH_TRUST_HOST=true` が無いと `UntrustedHost` でログインできない。
  サーバーアクションはOriginとHostの一致も検査するため、nginxで `Host` を転送すること(設定済み)
- **アップロード上限**: `next.config.ts` の `serverActions.bodySizeLimit` と nginx の
  `client_max_body_size` は同じ値(25MB)に揃えること
- **長いドメイン名**: ドメイン名が長く、nginxの既定の `server_names_hash_bucket_size` に収まらないため、
  `/etc/nginx/conf.d/server-names-hash.conf` で引き上げている(`setup-vps.sh`が設置)
- **可用性**: 単一VPSのため、プロセス監視(`Restart=always`済み)・OSの更新・バックアップは自前で行う。
  Supabaseプロジェクトが一時停止(INACTIVE)になるとアプリは動かない

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
