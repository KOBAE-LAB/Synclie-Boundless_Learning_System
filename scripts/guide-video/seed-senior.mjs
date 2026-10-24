import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ok = (r, w) => { if (r.error) { console.error("ERR", w, r.error.message); process.exit(1); } return r.data; };
const LI = "f41b29ab-4280-4ff8-834c-1dfe37bfe7c0";
const teacher = ok(await sb.from("profiles").select("id,organization_id").eq("email", "demo-teacher@example.test").single(), "teacher");
const sen = ok(await sb.from("profiles").select("id").eq("email", "demo-senior@example.test").single(), "sen");
await sb.from("consent_records").upsert({ student_id: sen.id, scope: "data_use", withdrawn_at: null }, { onConflict: "student_id,scope" });
const ser = ok(await sb.from("course_series").insert({ owner_teacher_id: teacher.id, title: "総合的な探究 島の未来を考える", subject: "高校1年", kind: "inquiry", fiscal_year: 2025, planned_lessons: 6, archived_at: new Date("2026-03-20").toISOString() }).select("id").single(), "series");
const proj = ok(await sb.from("inquiry_projects").insert({ series_id: ser.id, owner_teacher_id: teacher.id, kind: "solo", solo_student_id: sen.id, title: "総合的な探究 島の未来を考える", theme: "避難所を、高齢の人にも過ごしやすくするには?", fiscal_year: 2025, series_label: "総合的な探究 島の未来を考える" }).select("id").single(), "proj");
await sb.from("inquiry_project_members").upsert({ project_id: proj.id, student_id: sen.id });
const traj = (kind, v, up, body) => ({ project_id: proj.id, kind, version: v, up_to_stage_key: up, body, model: "demo", prompt_version: "demo" });
ok(await sb.from("inquiry_trajectories").insert([
  traj("live", 1, "analysis", "最初は「島の人口が減っている理由」を調べるつもりだった。友だちの「人が減ると、災害のとき誰が助けるの?」という一言で、問いが「島の防災と高齢者」に変わった。避難所は体育館だから安心だと考えていたが、祖父母や近所の人に聞くと、段差とトイレが大きな壁だと分かり、仮説を捨てた。アンケートの数字だけでは足りず、地図に避難経路を重ねて、坂道が壁になっていると見えてきた。"),
  traj("retrospective", 1, null, "振り返ると、転機は「誰の困りごとか」を具体的な人から聞いたことだった。数字や資料は、その話を確かめる道具になった。最初の問いを手放す勇気と、聞き取りを重ねる粘り強さが、探究を前に進めた。もう一度やるなら、もっと早く、避難所を実際に歩いて確かめたい。"),
]), "traj");
const stories = ok(await sb.from("inquiry_stage_stories").insert(["problem_setting", "information_gathering", "analysis"].map((k, i) => ({ project_id: proj.id, stage_key: k, kind: "live", version: 1, body: ["人口の話から、防災と高齢者へ。きっかけは友だちの一言で、問いが変わった。", "体育館なら安心という仮説を、祖父母の話で捨てた。段差とトイレが壁だった。", "数字だけでは足りず、地図に避難経路を重ねて、坂道の壁が見えた。"][i], model: "demo", prompt_version: "demo" }))).select("id,stage_key"), "stories");
const S = Object.fromEntries(stories.map((s) => [s.stage_key, s.id]));
const eps = [
  ["problem_setting", "question_shift", 1, 3, "最初は人口が減る理由を調べるつもりでした。でも友だちの「人が減ると、災害のとき誰が助けるの?」という一言で、問いが防災と高齢者に変わりました。"],
  ["information_gathering", "hypothesis_rejected", 2, 8, "避難所は体育館だから安心だと思っていました。でも祖父母に聞くと、段差とトイレがいちばんの壁だと分かって、その仮説を捨てました。"],
  ["analysis", "turning_point", 3, 15, "アンケートの数字だけでは足りませんでした。地図に避難経路を重ねたら、坂道が高齢者の壁になっていると見えてきました。"],
];
const epIds = [];
for (const [stage, type, seq, rd, body] of eps) {
  const e = ok(await sb.from("inquiry_episodes").insert({ project_id: proj.id, stage_key: stage, episode_type: type, seq, parent_story_id: S[stage], relative_day: rd, picked_by: "auto", prompt_version: "demo" }).select("id").single(), "episode");
  const v = ok(await sb.from("inquiry_episode_versions").insert({ episode_id: e.id, kind: "narrated", version: 1, body, context_header: `避難所をテーマにした探究の、${stage === "problem_setting" ? "課題設定" : stage === "information_gathering" ? "情報収集" : "整理・分析"}の場面`, model: "demo", prompt_version: "demo" }).select("id").single(), "ev");
  epIds.push(v.id);
}
const avatars = ok(await sb.from("avatar_options").select("id,label"), "avatars");
const av = avatars.find((a) => a.label === "きちんとした発表者") ?? avatars[0];
const per = ok(await sb.from("personas").insert({ course_id: null, tier: "senior", status: "approved", name: "2025年度の先輩 ミナト(AI)", nickname: "ミナト", source_fiscal_year: 2025, source_project_id: proj.id, created_by: teacher.id, organization_id: teacher.organization_id, avatar_id: av.id, avatar_status: "done", profile: { role: "去年、防災をテーマに探究した先輩", tone: "落ち着いた、親しみのある丁寧語" }, stance: { position: "思い込みを疑い、具体的な人の話を聞いて確かめる姿勢を大切にする", goal: "後輩が、自分の仮説を、人の話とデータで確かめられるようにする" }, behavior_rules: { speakingFrequency: "普通", teachingDegree: "問い返すのみ", interventionCondition: "後輩が迷っているとき、自分の経験が考える材料になりそうなとき" }, origin_note: "探究プロジェクト「総合的な探究 島の未来を考える」の記録から作った先輩のAI。" }).select("id").single(), "persona");
ok(await sb.from("persona_loans").insert({ persona_id: per.id, course_id: LI, mode: "then", scope: "same_school", status: "active", created_by: teacher.id, approved_by: teacher.id, approved_at: new Date().toISOString() }), "loan");
const sess = ok(await sb.from("learning_sessions").select("id").eq("course_id", LI).is("student_id", null).single(), "sess");
const turn = ok(await sb.from("dialogue_turns").insert({ session_id: sess.id, speaker_type: "persona", persona_id: per.id, persona_name: "2025年度の先輩 ミナト(AI)", content: "私も最初は、避難所は体育館だから大丈夫だと思っていました。でも祖父母に聞いたら、段差とトイレがいちばんの壁だと分かって、考えを変えたんです。みなさんは、どんな人に話を聞きましたか?", source_kind: "text", created_at: new Date(Date.now() - 10 * 3600000).toISOString() }).select("id").single(), "turn");
const { data: traj1 } = await sb.from("inquiry_trajectories").select("id").eq("project_id", proj.id).eq("kind", "live").single();
ok(await sb.from("dialogue_turn_retrievals").insert([
  { turn_id: turn.id, persona_id: per.id, kind: "trajectory", trajectory_id: traj1.id, mode: "then", rank: 1 },
  { turn_id: turn.id, persona_id: per.id, kind: "episode", episode_version_id: epIds[1], mode: "then", rank: 1, similarity: 0.82 },
]), "retr");
console.log("seeded senior", per.id);
