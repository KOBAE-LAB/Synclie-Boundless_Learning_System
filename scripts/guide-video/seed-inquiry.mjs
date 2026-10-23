import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ok = (r, w) => { if (r.error) { console.error("ERR", w, r.error.message); process.exit(1); } return r.data; };
const COURSE = "f41b29ab-4280-4ff8-834c-1dfe37bfe7c0", SERIES = "43eed46b-62ad-49ff-87a4-d3ee96122b7f";
const LABEL = "総合的な探究 島の未来を考える 第1回 島の暮らしの課題を見つける";
const a = ok(await sb.from("profiles").select("id").eq("email","demo-student@example.test").single(),"a");
const b = ok(await sb.from("profiles").select("id").eq("email","demo-student2@example.test").single(),"b");
const sh = ok(await sb.from("personas").select("id").eq("course_id", COURSE).eq("name","シオリ").single(),"sh");
const proj = ok(await sb.from("inquiry_projects").select("id").eq("series_id", SERIES).eq("kind","group").single(),"proj");
for (const s of [a,b]) await sb.from("consent_records").upsert({ student_id: s.id, scope: "data_use", withdrawn_at: null }, { onConflict: "student_id" });
const t0 = Date.now() - 26 * 3600000; // 昨日のうちに始まった議論(時間差)
const at = (m) => new Date(t0 + m * 60000).toISOString();
const sess = ok(await sb.from("learning_sessions").insert({ course_id: COURSE, student_id: null, mode: "group", started_at: at(0), project_id: proj.id, course_label: LABEL }).select("id").single(),"sess");
const T = [
  ["student", a, "避難所について調べたら、高齢の人が段差やトイレで困っている、という話を聞いたよ。"],
  ["persona", null, "それは大切な視点ですね。聞いた話は、どのくらいの人数の、どんな立場の人から聞きましたか?"],
  ["student", b, "(翌朝) 祖父母と近所の3人に聞いたよ。島の避難所は、体育館で段差が多いみたい。"],
  ["persona", null, "3人の聞き取りは良い出発点です。ほかの島の例や、役場の資料と比べると、課題がより確かになりそうですね。"],
  ["student", a, "役場の防災計画の資料も探してみる。次は、何人くらいの高齢者が島にいるかも調べたい。"],
];
const rows = T.map(([sp, st, content], i) => ({ session_id: sess.id, speaker_type: sp, persona_id: sp === "persona" ? sh.id : null, persona_name: sp === "persona" ? "シオリ" : null, content, source_kind: "text", author_student_id: st?.id ?? null, created_at: at(i === 2 || i === 3 ? 900 + i : i * 4) }));
ok(await sb.from("dialogue_turns").insert(rows), "turns");
console.log("ok");
