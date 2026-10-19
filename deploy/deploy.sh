#!/usr/bin/env bash
# 手元のMacから実行する更新スクリプト: ビルドしてVPSへ送り、再起動する。
# VPSはメモリが1GBで他アプリと同居しているため、ビルドはVPS上ではなく手元で行う。
#   ./deploy/deploy.sh
# 再起動(sudo)だけは、パスワード入力が必要なため最後に表示するコマンドをVPS上で実行する。
set -euo pipefail

HOST=ubuntu@49.212.150.72
DIR=/home/ubuntu/apps/synclie-bls
SSH="ssh -o BatchMode=yes -i $HOME/.ssh/kobae_lab_apps"

cd "$(dirname "$0")/.."

# NEXT_PUBLIC_* はビルド時にコード(サーバー側も含む)へ埋め込まれる。手元の .env.local は
# 開発用のSupabaseを指しているため、本番のビルドは .env.production.local(本番を指す値)で
# 上書きする。これを忘れると、本番が開発用DBのURL+本番の鍵という組み合わせになり、
# すべてのDB操作が「Invalid API key」で失敗する(2026-10-20に実際に起きた)。
ENV_FILE=.env.production.local
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE がありません。本番のSupabase URL/anonキーを書いたファイルを作ってください(README参照)。" >&2
  exit 1
fi
EXPECTED_URL="$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$EXPECTED_URL" ]; then
  echo "$ENV_FILE に NEXT_PUBLIC_SUPABASE_URL がありません。" >&2
  exit 1
fi

npm run build

# ビルド結果に、期待どおりの(本番の)接続先が入っていることを確かめてから送る。
if ! grep -rqF "$EXPECTED_URL" .next/server; then
  echo "ビルドに $EXPECTED_URL が見つかりません。中止します(別のSupabaseを指している可能性)。" >&2
  exit 1
fi
rsync -az --delete -e "$SSH" --exclude ".next/cache" --exclude ".next/dev" \
  .next package.json package-lock.json next.config.ts public deploy "$HOST:$DIR/"
$SSH "$HOST" "cd $DIR && npm ci --omit=dev"
echo
echo "アップロード完了。VPS上で次を実行して再起動してください:"
echo "  sudo systemctl restart synclie-bls"
