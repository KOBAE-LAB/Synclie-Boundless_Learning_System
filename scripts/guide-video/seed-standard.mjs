import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ok = (r, w) => { if (r.error) { console.error("ERR", w, r.error.message); process.exit(1); } return r.data; };
const COURSE = "8af811f4-27bb-4748-a0a7-8ae0fde040bf", SERIES = "22d53f44-6740-42cf-99dc-273eb2d43140";
const LABEL = "理科 光合成のしくみ 第1回 光の強さと光合成";
const stu = ok(await sb.from("profiles").select("id,owner:id").eq("email", "demo-student@example.test").single(), "stu");
const teacher = ok(await sb.from("profiles").select("id").eq("email", "demo-teacher@example.test").single(), "teacher");
const personas = ok(await sb.from("personas").select("id,name").eq("course_id", COURSE), "personas");
const P = Object.fromEntries(personas.map(p => [p.name, p.id]));
ok(await sb.from("consent_records").upsert({ student_id: stu.id, scope: "data_use", withdrawn_at: null }, { onConflict: "student_id" }), "consent");
let proj = (await sb.from("inquiry_projects").select("id").eq("series_id", SERIES).eq("solo_student_id", stu.id).maybeSingle()).data;
if (!proj) proj = ok(await sb.from("inquiry_projects").insert({ series_id: SERIES, owner_teacher_id: teacher.id, kind: "solo", solo_student_id: stu.id, title: "理科 光合成のしくみ", fiscal_year: 2026, series_label: "理科 光合成のしくみ" }).select("id").single(), "proj");
await sb.from("inquiry_project_members").upsert({ project_id: proj.id, student_id: stu.id });
const steps = ok(await sb.from("course_steps").select("id,kind").eq("course_id", COURSE), "steps");
const inp = steps.find(s => s.kind === "input");
const t0 = Date.now() - 50 * 60000;
const at = (m) => new Date(t0 + m * 60000).toISOString();
ok(await sb.from("step_progress").insert({ student_id: stu.id, step_id: inp.id, completed_at: at(0), answers: [], step_title: "光合成の資料を読む", step_kind: "input", course_label: LABEL }), "progress");
const sess = ok(await sb.from("learning_sessions").insert({ course_id: COURSE, student_id: stu.id, mode: "group", started_at: at(2), project_id: proj.id, course_label: LABEL }).select("id").single(), "session");
const turns = [
  ["persona", "ソウタ", "ねえ、光合成って、光が強ければ強いほど、ずっと速くなるんじゃないの?"],
  ["student", null, "光が弱いうちは、光を強くするほど速くなるよ。でも、ある強さをこえると、それ以上は変わらなくなると資料に書いてあったよ。"],
  ["persona", "ハルカ", "資料に書いてあるだけ? 本当にそうなる理由は説明できる? 実験の結果とかある?"],
  ["student", null, "資料のオオカナダモの実験で、ライトを近づけると気泡の数が増えるけど、ある距離より近くしても増えなくなるって例があったよ。光以外の、二酸化炭素や温度が足りなくなるからだと思う。"],
  ["persona", "ソウタ", "そっか、光だけじゃなくて二酸化炭素も必要だからなんだね。じゃあ、ライトを近づけすぎたら何か困ることはある?"],
  ["student", null, "ライトの熱で水温が上がると結果に影響するから、水温をそろえる工夫がいるよ。"],
  ["persona", "ハルカ", "なるほど、水温をそろえる話は説得力あるね。じゃあ、その実験を自分でやるなら、何をそろえて、何を変える?"],
];
const rows = turns.map(([sp, name, content], i) => ({ session_id: sess.id, speaker_type: sp, persona_id: name ? P[name] : null, persona_name: name, content, source_kind: "text", author_student_id: sp === "student" ? stu.id : null, created_at: at(3 + i * 2) }));
const ins = ok(await sb.from("dialogue_turns").insert(rows).select("id,speaker_type,created_at,persona_id").order("created_at"), "turns");
// 論証評価(学習者の発言ごと)
const evals = [[1, 3, 2, 0, false, "資料の内容を根拠に、光の強さと速さの関係を説明できています。"], [3, 4, 4, 2, true, "実験の例を根拠にして、ハルカの問いに具体的に応えています。"], [5, 4, 3, 2, true, "実験の条件(水温)という新しい視点を加えています。"]];
for (const [idx, ls, eq, rr, nev, c] of evals) {
  const t = ins[idx]; const next = ins[idx + 1];
  ok(await sb.from("argument_evaluations").insert({ dialogue_turn_id: t.id, logic_structure: ls, evidence_quality: eq, rebuttal_response: rr, has_new_evidence: nev, summary_comment: c, persona_id: next?.persona_id ?? null, persona_conceded: nev, unwarranted_conformity: false }), "eval");
}
const sub = ok(await sb.from("submissions").insert({ course_id: COURSE, student_id: stu.id, session_id: sess.id, kind: "text", content: "光合成の速さは、光が弱いうちは光を強くするほど大きくなるが、ある強さをこえると変わらなくなる。これは光合成が光だけでなく、二酸化炭素の濃度や温度にも左右されるからだと考えた。オオカナダモの実験では、ライトの熱で水温が上がらないよう、水温をそろえる必要がある。", feedback_status: "done", judgment_status: "done", project_id: proj.id, course_label: LABEL, created_at: at(20) }).select("id").single(), "sub");
const crit = ok(await sb.from("evaluation_criteria").select("id,label").eq("course_id", COURSE), "crit");
const fb = { "根拠の明確さ": ["資料の実験の例(オオカナダモ)を根拠に、結論を支えられています。", "気泡の数のほかに、どんなデータがあればもっと確かな根拠になるでしょうか。", "資料「光の強さと光合成の速さ」"], "反対意見への応答": ["ハルカの問いに、理由をあげて具体的に応えられています。", "「光が強いほど速くなる」というソウタの考えは、どんな場合なら正しいでしょうか。", "資料「光飽和」"] };
for (const c of crit) { const f = fb[c.label]; if (f) ok(await sb.from("submission_feedback").insert({ submission_id: sub.id, criteria_id: c.id, criteria_label: c.label, good_points: f[0], next_question: f[1], material_reference: f[2] }), "fb"); }
ok(await sb.from("discussion_judgments").insert({ submission_id: sub.id, logic_structure: 4, evidence_quality: 4, rebuttal_response: 3, summary_comment: "議論全体を通して、資料と実験の例を根拠に筋道立てて説明できていました。反対の見方を、さらに自分から探すと深まります。" }), "judge");
ok(await sb.from("reflections").insert({ submission_id: sub.id, student_id: stu.id, what_learned: "光の強さだけでなく、二酸化炭素や温度も光合成の速さに関わることが分かった。", what_confused: "光飽和のとき、実際に何が足りなくなっているのかを、どう確かめればよいか。", next_goal: "二酸化炭素の濃度を変える実験を考えてみたい。", shared_with_teacher: true }), "refl");
console.log("seeded", sess.id, sub.id);
