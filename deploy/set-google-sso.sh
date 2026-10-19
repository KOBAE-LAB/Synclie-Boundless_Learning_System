#!/bin/bash
# VPS上で実行する: GoogleのSSO用クライアントIDとシークレットを .env.local に書き込む。
#   bash /home/ubuntu/apps/synclie-bls/deploy/set-google-sso.sh
# シークレットは入力しても画面に表示されず、シェルの履歴にも残らない(チャットにも貼らない)。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/apps/synclie-bls/.env.local}"
test -f "$ENV_FILE"

read -r -p "Google クライアントID: " GOOGLE_ID
read -r -s -p "Google クライアントシークレット(入力は表示されません): " GOOGLE_SECRET
echo

# 取り違え(メールアドレスやパスワードを入れてしまう等)を防ぐための形式チェック。
# Google Cloud Console の「OAuth クライアント」に表示される値は次の形をしている。
if ! [[ "$GOOGLE_ID" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]]; then
  echo "クライアントIDの形式が違います(例: 123456789012-abcdef.apps.googleusercontent.com)。" >&2
  echo "Google Cloud Console の「認証情報」で作ったOAuthクライアントの値を入れてください。" >&2
  exit 1
fi
if ! [[ "$GOOGLE_SECRET" =~ ^GOCSPX- ]]; then
  echo "クライアントシークレットは「GOCSPX-」で始まる値です。違う値(パスワード等)は入れないでください。" >&2
  exit 1
fi

# 既存の同名の行があれば置き換え、無ければ末尾に追加する(値はenv経由で渡し、特殊文字を壊さない)
GOOGLE_ID="$GOOGLE_ID" GOOGLE_SECRET="$GOOGLE_SECRET" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os
path = os.environ["ENV_FILE"]
values = {
    "AUTH_GOOGLE_ID": os.environ["GOOGLE_ID"],
    "AUTH_GOOGLE_SECRET": os.environ["GOOGLE_SECRET"],
}
lines = open(path, encoding="utf-8").read().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0]
    if key in values:
        out.append(f"{key}={values[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
chmod 600 "$ENV_FILE"
echo "設定しました。反映するには次を実行してください:"
echo "  sudo systemctl restart synclie-bls"
