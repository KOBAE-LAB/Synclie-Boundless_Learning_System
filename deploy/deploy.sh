#!/usr/bin/env bash
# VPS上で実行する更新スクリプト: 最新のmainを取得してビルドし、サービスを再起動する。
# 使い方: cd /opt/synclie && ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
git fetch origin main
git reset --hard origin/main
npm ci
npm run build
sudo systemctl restart synclie
sudo systemctl --no-pager status synclie | head -5
