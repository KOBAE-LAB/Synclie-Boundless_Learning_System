-- 集約型ペルソナ(要件定義書14章の実装(2c)、2026-10-23、先生の決定)。
--   前の年度の教科・科目の、複数の学習者の記録(②: 軌跡・場面)から、共通するつまずき・よくある誤解・有効だった問いをまとめて、
--   「前の年度の学習者の記録をもとにしたAI」を作る。個人の発言は材料にもAIへの入力にも使わず(要約だけ)、同意した学習者が
--   MIN_AGGREGATE_LEARNERS(3)人以上いるときだけ作る。先輩型と同じく、先生が作って承認し、同じ学校の授業回に貸し出す(参照だけ)。

-- 1. ペルソナの種類に aggregate を足す。まとめた項目(つまずき等)は stance.items(jsonb)に持つので、列は増やさない。
alter table personas drop constraint if exists personas_tier_check;
alter table personas
  add constraint personas_tier_check
  check (tier in ('teacher_defined', 'rag_initial', 'evolved', 'senior', 'other_school', 'aggregate'));

-- 表示用の「どの教科・科目から作ったか」。教科・科目が消えても、集約型のペルソナ自体は残す(材料はプロジェクトで持つ)。
alter table personas add column if not exists source_series_id uuid references course_series(id) on delete set null;

-- 2. 材料のプロジェクト(出典)。プロジェクトが消えたら(学習者本人の全データ削除など)、この行も消える。
--    残った材料の学習者が MIN 人を下回ったら、集約型は話さない(アプリが数える)。
create table if not exists persona_source_projects (
  persona_id uuid not null references personas(id) on delete cascade,
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  primary key (persona_id, project_id)
);
create index if not exists persona_source_projects_project_idx on persona_source_projects (project_id);
alter table persona_source_projects enable row level security;
revoke all on persona_source_projects from anon, authenticated;

-- 3. 検索の記録に、集約型が読んだ「まとめ」を残せるようにする(個別の記録を指さないので、参照の列は持たない)。
alter table dialogue_turn_retrievals drop constraint if exists dialogue_turn_retrievals_kind_check;
alter table dialogue_turn_retrievals
  add constraint dialogue_turn_retrievals_kind_check
  check (kind in ('trajectory', 'stage_story', 'episode', 'aggregate'));
