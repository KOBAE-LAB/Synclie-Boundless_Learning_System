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
npm run build
rsync -az --delete -e "$SSH" --exclude ".next/cache" --exclude ".next/dev" \
  .next package.json package-lock.json next.config.ts public deploy "$HOST:$DIR/"
$SSH "$HOST" "cd $DIR && npm ci --omit=dev"
echo
echo "アップロード完了。VPS上で次を実行して再起動してください:"
echo "  sudo systemctl restart synclie-bls"
