#!/bin/bash
# VPS上で1回だけ実行する初期設定(systemdとnginxとHTTPS証明書)。root権限が必要。
#   sudo bash /home/ubuntu/apps/synclie-bls/deploy/setup-vps.sh
# 事前に、アプリ本体(.next, node_modules, .env.local)がこのディレクトリに配置済みであること。
set -euo pipefail

DOMAIN=synclie-boundless-learning-system.kobae-lab.com
APP=/home/ubuntu/apps/synclie-bls

if [ "$(id -u)" -ne 0 ]; then
  echo "Run: sudo bash $0"
  exit 1
fi
test -d "$APP/.next" && test -f "$APP/.env.local" && test -x "$APP/node_modules/.bin/next"

# 1) systemd
cp "$APP/deploy/synclie-bls.service" /etc/systemd/system/synclie-bls.service
systemctl daemon-reload
systemctl enable --now synclie-bls
sleep 3
systemctl is-active synclie-bls

# 2) nginx(まずHTTPだけ。HTTPS化はcertbotが追記する)
# このドメイン名は長く、nginxの既定(server_names_hash_bucket_size 64)に収まらず
# `nginx -t` が失敗するため、conf.d で引き上げる(他のサイトの設定は変更しない)
echo 'server_names_hash_bucket_size 128;' > /etc/nginx/conf.d/server-names-hash.conf
cat > /etc/nginx/sites-available/$DOMAIN <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # 資料・手書き画像・音声のアップロード上限(next.config.ts の serverActions.bodySizeLimit と揃える)
    client_max_body_size 25m;
    # AI呼び出しが長引く場合に備えて長めにする
    proxy_read_timeout 180s;

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t
systemctl reload nginx

# 3) HTTPS(Let's Encrypt)。DNSのAレコードがこのVPSを指していること
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect
nginx -t
systemctl reload nginx

echo "OK: https://$DOMAIN/"
