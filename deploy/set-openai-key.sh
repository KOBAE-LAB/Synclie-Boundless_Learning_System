#!/bin/bash
# OpenAIのAPIキーを .env.local に書き込む(本番はVPS上で、開発は手元で実行する)。
#   本番(VPS): bash /home/ubuntu/apps/synclie-bls/deploy/set-openai-key.sh
#   開発(手元): ENV_FILE=.env.local bash deploy/set-openai-key.sh
# キーは入力しても画面に表示されず、シェルの履歴にも残らない(チャットにも貼らない)。
# 書き込む前に、OpenAIに問い合わせて有効なキーか確かめる。無効なら何も書き換えない。
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/apps/synclie-bls/.env.local}"
test -f "$ENV_FILE" || { echo "$ENV_FILE が見つかりません。" >&2; exit 1; }

read -r -s -p "OpenAI APIキー(入力は表示されません): " KEY
echo
# 取り違え(パスワード等を入れてしまう)を防ぐ形式チェック。OpenAIのキーは「sk-」で始まる。
if ! [[ "$KEY" =~ ^sk-[A-Za-z0-9_-]{20,}$ ]]; then
  echo "OpenAIのAPIキーの形式ではありません(「sk-」で始まる長い文字列です)。" >&2
  exit 1
fi

# 有効かどうかを、モデル一覧の取得で確かめる(課金は発生しない)。SKIP_CHECK=1 は動作テスト用。
if [ "${SKIP_CHECK:-}" != "1" ]; then
  code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY" https://api.openai.com/v1/models || true)
  if [ "$code" != "200" ]; then
    echo "このキーはOpenAIに受け付けられませんでした(HTTP $code)。.env.local は変更していません。" >&2
    echo "キーの取り違え、削除・無効化、支払い設定(残高)を、OpenAIの管理画面で確かめてください。" >&2
    exit 1
  fi
  echo "キーは有効です。"
fi

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
KEY="$KEY" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os
path = os.environ["ENV_FILE"]
lines = open(path, encoding="utf-8").read().splitlines()
out, seen = [], False
for line in lines:
    if line.split("=", 1)[0] == "OPENAI_API_KEY":
        out.append("OPENAI_API_KEY=" + os.environ["KEY"]); seen = True
    else:
        out.append(line)
if not seen:
    out.append("OPENAI_API_KEY=" + os.environ["KEY"])
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
echo "OPENAI_API_KEY を書き込みました($ENV_FILE)。古い内容は同じ場所に .bak-日時 で残しています。"
echo "反映するには、アプリを再起動してください(本番: sudo systemctl restart synclie-bls / 開発: 開発サーバーを再起動)。"
