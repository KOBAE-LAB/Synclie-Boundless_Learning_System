-- データ基盤の再設計(要件定義書14章)のPart A: 生ログ(①記録層)の保護。
-- 草案 docs/drafts/0042_data_foundation_draft.sql の Part A に、草案の Part C のうち①だけに関わる部分
-- (C1 授業の控えの埋め戻し、C2/C3 既存の記録の個人プロジェクトへの束ね)を前倒しで含めた。
-- 理由: 控えとプロジェクトが無いまま授業回が消えると、記録は残っても「どの授業の記録か」が分からなくなるため。
-- Part C の残り(F26・ペルソナの版1)は、Part B のテーブルができてから 0044 で入れる。
--
-- 方針(14章の設計原則):
--   ① 生ログは書き換えない / 授業(授業回・シリーズ)の削除で消えない。
--      記録ごと消えるのは、学習者本人の全データ削除(F16)と、管理者の「テストデータの消去」だけ(どちらもアプリが明示的に消す)。
--   このマイグレーションは、列とテーブルの追加と、削除ルールの変更と、空の列の埋め戻しだけで、既存のデータは消さない。

-- ============================================================================
-- A1. 探究プロジェクト: 記録をまとめる、授業から独立した単位。
--   グループ × テーマ × 期間。個人の独習・いまの学習は1人のプロジェクト(kind='solo')。複数の授業回にまたがる。
--   授業シリーズを消しても、プロジェクトと記録は残る(series_id は set null、series_label が控え)。
-- ============================================================================
create table if not exists inquiry_projects (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references course_series(id) on delete set null,
  owner_teacher_id uuid references profiles(id) on delete set null,
  kind text not null default 'solo' check (kind in ('group', 'solo')),
  -- 個人プロジェクトの本人。(シリーズ, 本人) で1つに保つため(グループでは null)。
  solo_student_id uuid references profiles(id) on delete cascade,
  title text not null,
  theme text,
  fiscal_year int,
  starts_on date,
  ends_on date,
  -- 段階の定義。null = 既定の4段階。[{ "key": "...", "label": "...", "canonical": "problem_setting|information_gathering|analysis|expression" }]
  stage_set jsonb,
  -- シリーズが消えても、記録の文脈(どの授業シリーズだったか)を読めるようにする控え
  series_label text,
  created_at timestamptz not null default now(),
  check ((kind = 'solo') = (solo_student_id is not null))
);
create index if not exists inquiry_projects_series_idx on inquiry_projects (series_id);
-- 個人プロジェクトは (シリーズ, 本人) で1つ。部分インデックスにしないのは、upsert の onConflict で使えるようにするため
-- (グループは solo_student_id が null なので、この一意性にかからない)。
create unique index if not exists inquiry_projects_series_solo_key on inquiry_projects (series_id, solo_student_id);

create table if not exists inquiry_project_members (
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (project_id, student_id)
);
create index if not exists inquiry_project_members_student_idx on inquiry_project_members (student_id);

-- ============================================================================
-- A2. ①の行に、プロジェクトと「授業の控え」(シリーズ名 第N回 名前)を持たせる。
-- ============================================================================
alter table learning_sessions
  add column if not exists project_id uuid references inquiry_projects(id) on delete restrict,
  add column if not exists course_label text;
alter table submissions
  add column if not exists project_id uuid references inquiry_projects(id) on delete restrict,
  add column if not exists course_label text;
create index if not exists learning_sessions_project_idx on learning_sessions (project_id);
create index if not exists submissions_project_idx on submissions (project_id);

-- ============================================================================
-- A3. 連鎖削除をやめる: 授業回(シリーズ)を消しても、学習者の記録は残る。
--   course_id は null になり、course_label(控え)とプロジェクトが文脈を持つ。
-- ============================================================================
alter table submissions alter column course_id drop not null;

alter table learning_sessions drop constraint if exists learning_sessions_course_id_fkey;
alter table learning_sessions
  add constraint learning_sessions_course_id_fkey foreign key (course_id) references courses(id) on delete set null;

alter table submissions drop constraint if exists submissions_course_id_fkey;
alter table submissions
  add constraint submissions_course_id_fkey foreign key (course_id) references courses(id) on delete set null;

-- 学習者本人の学習計画(TODO)は、授業が消えても残す。
alter table study_plan_items drop constraint if exists study_plan_items_course_id_fkey;
alter table study_plan_items
  add constraint study_plan_items_course_id_fkey foreign key (course_id) references courses(id) on delete set null;

-- インプット/アウトプットの進み: ステップ(授業の構成)を消しても、学習者の進みと答えは残す。
--   主キーを (student_id, step_id) から代理キーに替え、step_id は null を許す。ステップの控えを持つ。
--   (student_id, step_id) の一意性は残す(アプリの upsert の onConflict がこれを使う)。
alter table step_progress add column if not exists id uuid default gen_random_uuid();
update step_progress set id = gen_random_uuid() where id is null;
alter table step_progress
  add column if not exists step_title text,
  add column if not exists step_kind text,
  add column if not exists course_label text;
alter table step_progress drop constraint if exists step_progress_pkey;
alter table step_progress alter column id set not null;
alter table step_progress add primary key (id);
alter table step_progress alter column step_id drop not null;
alter table step_progress drop constraint if exists step_progress_step_id_fkey;
alter table step_progress
  add constraint step_progress_step_id_fkey foreign key (step_id) references course_steps(id) on delete set null;
create unique index if not exists step_progress_student_step_key on step_progress (student_id, step_id);

-- 対話ログの擬似メンバー参照: 擬似メンバー(授業の構成)を消しても、その発言(①)は残す。
--   これまでは外部キーが NO ACTION で、擬似メンバーを消すと失敗していた。発言者の名前は控え(persona_name)に持つ。
alter table dialogue_turns add column if not exists persona_name text;
alter table dialogue_turns drop constraint if exists dialogue_turns_persona_id_fkey;
alter table dialogue_turns
  add constraint dialogue_turns_persona_id_fkey foreign key (persona_id) references personas(id) on delete set null;

-- ============================================================================
-- A4. 発言の修正版: 教師の発言監査(F15)は、元の発言(content)を書き換えず、修正版を別に持つ。
--   対話に渡す履歴・画面の表示は、最新の修正版があればそれを使う。元の発言は①として残る。
-- ============================================================================
create table if not exists dialogue_turn_corrections (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references dialogue_turns(id) on delete cascade,
  corrected_content text not null,
  note text,
  corrected_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dialogue_turn_corrections_turn_idx on dialogue_turn_corrections (turn_id, created_at desc);

alter table inquiry_projects enable row level security;
alter table inquiry_project_members enable row level security;
alter table dialogue_turn_corrections enable row level security;
-- 公開API(anon/authenticated)の権限は 0041 の既定で外れるが、念のため明示的にも外す。
revoke all on inquiry_projects, inquiry_project_members, dialogue_turn_corrections from anon, authenticated;

-- ============================================================================
-- 埋め戻し(草案のC1〜C3): 既存の記録に、控えとプロジェクトを付ける。
-- ============================================================================

-- 授業の控え: いまの授業回の名前(「シリーズ名 第N回 名前」、アプリの lessonFullName と同じ形)。
update learning_sessions s
set course_label = concat(cs.title, ' 第', c.lesson_no, '回 ', c.title)
from courses c join course_series cs on cs.id = c.series_id
where s.course_id = c.id and s.course_label is null;

update submissions s
set course_label = concat(cs.title, ' 第', c.lesson_no, '回 ', c.title)
from courses c join course_series cs on cs.id = c.series_id
where s.course_id = c.id and s.course_label is null;

update step_progress p
set step_title = st.title, step_kind = st.kind,
    course_label = concat(cs.title, ' 第', c.lesson_no, '回 ', c.title)
from course_steps st join courses c on c.id = st.course_id join course_series cs on cs.id = c.series_id
where p.step_id = st.id and p.step_title is null;

update dialogue_turns t
set persona_name = p.name
from personas p
where t.persona_id = p.id and t.persona_name is null;

-- 既存の記録を、「学習者 × シリーズ」ごとの個人プロジェクト(kind='solo')に束ねる。
--   人間のグループはまだ無いので、いまの記録はすべて1人のプロジェクトになる。
insert into inquiry_projects (series_id, owner_teacher_id, kind, solo_student_id, title, fiscal_year, series_label)
select distinct on (x.series_id, x.student_id)
       x.series_id, cs.owner_teacher_id, 'solo', x.student_id, cs.title, cs.fiscal_year, cs.title
from (
  select c.series_id, ls.student_id
  from learning_sessions ls join courses c on c.id = ls.course_id
  where ls.student_id is not null and ls.project_id is null
  union
  select c.series_id, s.student_id
  from submissions s join courses c on c.id = s.course_id
  where s.student_id is not null and s.project_id is null
) x
join course_series cs on cs.id = x.series_id
on conflict (series_id, solo_student_id) do nothing;

insert into inquiry_project_members (project_id, student_id)
select id, solo_student_id from inquiry_projects where kind = 'solo'
on conflict do nothing;

update learning_sessions ls
set project_id = p.id
from courses c join inquiry_projects p on p.series_id = c.series_id and p.kind = 'solo'
where ls.course_id = c.id and p.solo_student_id = ls.student_id and ls.project_id is null;

update submissions s
set project_id = p.id
from courses c join inquiry_projects p on p.series_id = c.series_id and p.kind = 'solo'
where s.course_id = c.id and p.solo_student_id = s.student_id and s.project_id is null;
