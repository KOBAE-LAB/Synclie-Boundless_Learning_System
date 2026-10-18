#!/usr/bin/env node
/**
 * 段階1向けの開発用スクリプト: テスト用のログインアカウント(教師/生徒)を作成する。
 *
 * まだサインアップ画面がないため(F01〜F09の範囲外)、開発中はこのスクリプトで
 * profiles テーブルに直接アカウントを作る。
 *
 * 使い方:
 *   node scripts/dev/create-user.mjs --email teacher@example.com --password xxxx \
 *     --role teacher --name "宮田 先生"
 *
 * 必要な環境変数(.env.local から読み込む場合は `node --env-file=.env.local ...`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key) args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { email, password, role = "teacher", name = "", admin = "false" } = args;

  if (!email || !password) {
    console.error(
      "使い方: node scripts/dev/create-user.mjs --email <email> --password <password> [--role teacher|student|guardian] [--name <表示名>] [--admin true]",
    );
    process.exit(1);
  }
  if (!["teacher", "student", "guardian"].includes(role)) {
    console.error("--role は teacher / student / guardian のいずれかにしてください。");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を設定してください。",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: crypto.randomUUID(),
        email,
        password_hash: passwordHash,
        role,
        display_name: name,
        // 管理者は教師アカウントの1つに付く属性(教師の自己登録の承認ができる)
        is_admin: admin === "true" && role === "teacher",
        approval_status: "approved",
      },
      { onConflict: "email" },
    )
    .select("id, email, role, display_name")
    .single();

  if (error) {
    console.error("作成に失敗しました:", error.message);
    process.exit(1);
  }

  console.log("アカウントを作成/更新しました:", data);
}

main();
