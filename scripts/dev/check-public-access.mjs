#!/usr/bin/env node
/**
 * 公開API(anonキー)から、DBやファイルに触れられないことを確かめる。
 * 本番の公開前・テーブルを足したあとに、実行して「すべて PASS」になることを確認する。
 *
 * 使い方(開発DB): node --env-file=.env.local scripts/dev/check-public-access.mjs
 * 使い方(本番DB): node --env-file=.env.production.local scripts/dev/check-public-access.mjs
 *   必要な環境変数: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY(読み取りだけ。書き込みは試して拒否されることを確かめる)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。");
  process.exit(1);
}
const c = createClient(url, key, { auth: { persistSession: false } });

let failed = 0;
const report = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} ${detail}`);
};

// 個人情報を持つ主なテーブル。権限が無いので、エラーになる(または行が返らない)のが正しい。
for (const table of ["profiles", "submissions", "dialogue_turns", "reflections", "consent_records", "course_series", "personas"]) {
  const r = await c.from(table).select("*").limit(1);
  report(`read ${table}`, !!r.error || (r.data ?? []).length === 0, r.error ? `denied (${r.error.code})` : `rows=${r.data.length}`);
}

const insert = await c.from("profiles").insert({ email: "check@example.invalid", role: "student" });
report("insert profiles", !!insert.error, insert.error ? `denied (${insert.error.code})` : "INSERTED");

const rpc = await c.rpc("match_material_chunks", {
  p_course_id: "00000000-0000-0000-0000-000000000000",
  p_query_embedding: Array(1536).fill(0),
  p_match_count: 1,
});
report("rpc match_material_chunks", !!rpc.error || (rpc.data ?? []).length === 0, rpc.error ? `denied (${rpc.error.code})` : `rows=${rpc.data?.length}`);

for (const bucket of ["materials", "handwriting", "audio"]) {
  const r = await c.storage.from(bucket).list("");
  report(`storage ${bucket}`, !!r.error || (r.data ?? []).length === 0, r.error ? `denied` : `files=${r.data.length}`);
}

console.log(failed === 0 ? "\nすべて PASS: 公開APIからは、何も読み書きできません。" : `\n${failed}件 FAIL: 公開APIから触れる箇所があります。`);
process.exit(failed === 0 ? 0 : 1);
