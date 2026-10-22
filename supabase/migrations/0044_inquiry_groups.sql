-- 探究シリーズと人間のグループ(2026-10-21、先生の判断):
--   今のSynclieの中に「探究」を加える。授業シリーズを作るときに「探究」を選ぶと、グループで探究する。
--   議論は時間差(非同期)が基本。グループは教師の割り当てと生徒のコード参加の両方で作れる。
--   テーマはグループが決めて更新でき、変更の履歴を記録として残す(問いの変化も探究の一部)。
--
-- 方針: グループの議論は、授業回ごとに1つの共有の対話セッション(student_id は null、project_id がグループ)。
--   発言した学習者は dialogue_turns.author_student_id に持つ(個人の議論でも入れる)。既存のデータは消さない。

-- シリーズの種類
alter table course_series
  add column if not exists kind text not null default 'standard' check (kind in ('standard', 'inquiry'));

-- グループの参加コード(生徒がコードで参加する)。シリーズの授業コードとは別。
alter table inquiry_projects add column if not exists join_code text;
create unique index if not exists inquiry_projects_join_code_key on inquiry_projects (join_code);

-- メンバーの脱退(グループの入れ替え)。行は消さずに残し、いつ抜けたかを持つ(誰がいつ探究に関わったかの記録)。
alter table inquiry_project_members add column if not exists left_at timestamptz;
create index if not exists inquiry_project_members_active_idx on inquiry_project_members (student_id) where left_at is null;

-- テーマの変更の履歴(①の記録。軌跡や「問いの変化」のエピソードの材料になる)
create table if not exists inquiry_theme_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  theme text not null,
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_theme_changes_project_idx on inquiry_theme_changes (project_id, created_at);

-- 発言した学習者。グループの議論では、誰の発言かをここで持つ。学習者本人の全データ削除のときに、本人の発言だけを消すのにも使う。
alter table dialogue_turns
  add column if not exists author_student_id uuid references profiles(id) on delete set null;
create index if not exists dialogue_turns_author_idx on dialogue_turns (author_student_id);

-- 既存の個人の議論の学習者の発言に、発言者を埋める。
update dialogue_turns t
set author_student_id = s.student_id
from learning_sessions s
where t.session_id = s.id and t.speaker_type = 'student' and t.author_student_id is null and s.student_id is not null;

-- グループの議論は、授業回×グループで1つ(同時に最初の発言をしても2つにならないように)。
create unique index if not exists learning_sessions_group_lesson_key
  on learning_sessions (course_id, project_id) where student_id is null;

alter table inquiry_theme_changes enable row level security;
revoke all on inquiry_theme_changes from anon, authenticated;
