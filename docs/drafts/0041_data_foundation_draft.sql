-- 【草案・未適用】データ基盤の再設計(3層)のマイグレーション。要件定義書14章「ステップ4」の草案。
--
-- このファイルは supabase/migrations/ には置かない(置くと db push で適用されてしまう)。
-- 実装するときに、次の3つのマイグレーションに分けて、順に supabase/migrations/ へ移す:
--   0041  Part A: 生ログの保護(連鎖削除の解消・探究プロジェクト・修正版)  ← 最優先。データを失わないための手当て
--   0042  Part B: 抽出層(②)と投射層(③)のテーブル
--   0043  Part C: 既存データの移し替え(バックフィル)
-- 検証: 開発DBで begin; … rollback; の中で通ることを確認済み(DBは変更していない)。
--
-- 方針(14章の設計原則):
--   ① 生ログは書き換えない / 授業(授業回・シリーズ)の削除で消えない。消えるのは学習者本人の全データ削除(F16)だけ。
--   ② 加工したものは版で重ねる。すべての行が出典(①)をたどれる。
--   ③ 授業から独立して残る。貸し出しは参照のみ。

-- ============================================================================
-- Part A: 生ログの保護(0041)
-- ============================================================================

-- A1. 探究プロジェクト: ①②③をつなぐ、授業から独立した安定した単位。
--   グループ × テーマ × 期間。個人の独習は1人のプロジェクト(kind='solo')。複数の授業回にまたがる。
--   授業シリーズを消しても、プロジェクトと記録は残る(series_id は set null)。
create table if not exists inquiry_projects (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references course_series(id) on delete set null,
  owner_teacher_id uuid references profiles(id) on delete set null,
  kind text not null default 'solo' check (kind in ('group', 'solo')),
  title text not null,
  theme text,
  fiscal_year int,
  starts_on date,
  ends_on date,
  -- 段階の定義。null = 既定の4段階。[{ "key": "...", "label": "...", "canonical": "problem_setting|information_gathering|analysis|expression" }]
  -- canonical は、アーカイブを横断するときの既定4段階との対応。
  stage_set jsonb,
  -- シリーズが消えても、記録の文脈(どの授業だったか)を読めるようにする控え
  series_label text,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_projects_series_idx on inquiry_projects (series_id);

create table if not exists inquiry_project_members (
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (project_id, student_id)
);
create index if not exists inquiry_project_members_student_idx on inquiry_project_members (student_id);

-- A2. ①の行にプロジェクトと「授業の控え」を持たせる。
alter table learning_sessions
  add column if not exists project_id uuid references inquiry_projects(id) on delete restrict,
  add column if not exists course_label text;
alter table submissions
  add column if not exists project_id uuid references inquiry_projects(id) on delete restrict,
  add column if not exists course_label text;
create index if not exists learning_sessions_project_idx on learning_sessions (project_id);
create index if not exists submissions_project_idx on submissions (project_id);

-- A3. 連鎖削除をやめる: 授業回を消しても、学習者の記録(対話・成果)は残る。
--   course_id は null になり、course_label(控え)とプロジェクトが文脈を持つ。
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
--   発言者の名前は控え(persona_name)に持つ。
alter table dialogue_turns add column if not exists persona_name text;
alter table dialogue_turns drop constraint if exists dialogue_turns_persona_id_fkey;
alter table dialogue_turns
  add constraint dialogue_turns_persona_id_fkey foreign key (persona_id) references personas(id) on delete set null;

-- A4. 発言の修正版: 教師の発言監査(F15)は、元の発言(content)を書き換えず、修正版を別に持つ。
--   対話に渡す履歴・画面の表示は、最新の修正版があればそれを使う。元の発言は①として残る。
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

-- ============================================================================
-- Part B: 抽出層(②)と投射層(③)(0042)
-- ============================================================================

-- B1. 軌跡: プロジェクト全体の物語。版で重ねる(上書きしない)。ペルソナのプロンプトに常に入る。
create table if not exists inquiry_trajectories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  version int not null,
  body text not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

-- B2. 段階の物語: 段階ごとの「何に迷い、何を決めたか」。
--   kind: live = 段階の切り替え時に、その場の視点で書く / retrospective = 探究の終了後に振り返って書く
create table if not exists inquiry_stage_stories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  stage_key text not null,
  kind text not null check (kind in ('live', 'retrospective')),
  version int not null,
  body text not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (project_id, stage_key, kind, version)
);

-- B3. エピソード: 意味のある1場面。RAGの検索単位。前後と親を参照して、文脈ごと引ける。
create table if not exists inquiry_episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  stage_key text not null,
  -- 種類の叩き台: question_shift(問いの変化) / hypothesis_rejected(仮説の棄却) / stuck(行き詰まり) / turning_point(転機) / discovery(発見)。
  -- 実データを見て増減するため、check制約にせず text で持つ。
  episode_type text not null,
  seq int not null,
  prev_episode_id uuid references inquiry_episodes(id) on delete set null,
  parent_story_id uuid references inquiry_stage_stories(id) on delete set null,
  -- プロジェクト内の相対時期(「当時の自分」として話すペルソナは、後輩の現在の段階までしか使わない)
  relative_day int,
  lesson_no int,
  picked_by text not null default 'auto' check (picked_by in ('auto', 'student', 'teacher')),
  created_at timestamptz not null default now(),
  unique (project_id, seq)
);
create index if not exists inquiry_episodes_stage_idx on inquiry_episodes (project_id, stage_key);

-- B4. エピソードの版: 原文の抜粋 → 匿名化 → 一人称の語り、を並べて持つ。検索の埋め込みは語りの版に持たせる。
create table if not exists inquiry_episode_versions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references inquiry_episodes(id) on delete cascade,
  kind text not null check (kind in ('excerpt', 'anonymized', 'narrated')),
  version int not null,
  body text not null,
  embedding vector(1536),
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (episode_id, kind, version)
);

-- B5. 出典: ②③のすべての行が、どの①から作られたかを持つ。
--   用途: (1) ペルソナの発言の根拠をたどる (2) 抽出方法を改良したときに①から作り直す
--         (3) 学習者本人の全データ削除(F16)のとき、出典をたどって②③の派生物も消す。
--   多態の参照(行き先が複数のテーブル)のため、外部キーは張らず、アプリが整合を守る。
create table if not exists inquiry_sources (
  id uuid primary key default gen_random_uuid(),
  derived_kind text not null check (derived_kind in ('trajectory', 'stage_story', 'episode_version', 'persona_version')),
  derived_id uuid not null,
  source_kind text not null check (source_kind in ('dialogue_turn', 'submission', 'reflection', 'argument_evaluation')),
  source_id uuid not null,
  role text,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_sources_derived_idx on inquiry_sources (derived_kind, derived_id);
create index if not exists inquiry_sources_source_idx on inquiry_sources (source_kind, source_id);

-- B6. アーカイブ(学校・組織単位): ペルソナと②を保管する場所。授業の削除や年度の切り替えと無関係に残る。
create table if not exists persona_archives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

-- B7. ペルソナの版(要件定義書6章「各版を保存」)。
create table if not exists persona_versions (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,            -- { name, profile, stance, behavior_rules }
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (persona_id, version)
);

-- B8. ペルソナに、アーカイブ・系譜・種類を持たせる。先輩型・他校型の種類を足す。
alter table personas drop constraint if exists personas_tier_check;
alter table personas
  add constraint personas_tier_check
  check (tier in ('teacher_defined', 'rag_initial', 'evolved', 'senior', 'other_school'));
alter table personas
  add column if not exists archive_id uuid references persona_archives(id) on delete set null,
  add column if not exists source_persona_id uuid references personas(id) on delete set null,
  add column if not exists source_trajectory_id uuid references inquiry_trajectories(id) on delete set null,
  add column if not exists current_version int not null default 1;
-- アーカイブに登録したペルソナは、授業回を消しても残す。登録していないものは、これまでどおり授業回と一緒に消える
-- (アプリが、授業回の削除時に archive_id が null のものだけを消す)。
alter table personas drop constraint if exists personas_course_id_fkey;
alter table personas
  add constraint personas_course_id_fkey foreign key (course_id) references courses(id) on delete set null;

-- 授業回を消すとき、アーカイブに登録していない擬似メンバーは、これまでどおり一緒に消す(授業の構成だから)。
create or replace function delete_unarchived_personas() returns trigger language plpgsql as $$
begin
  delete from personas where course_id = old.id and archive_id is null;
  return old;
end $$;
drop trigger if exists courses_delete_unarchived_personas on courses;
create trigger courses_delete_unarchived_personas before delete on courses
  for each row execute function delete_unarchived_personas();

-- どの版が、どの対話で使われたか。
alter table dialogue_turns
  add column if not exists persona_version_id uuid references persona_versions(id) on delete set null;

-- B9. 貸し出し: アーカイブのペルソナを、新しい探究プロジェクトで参照のみで使う(F21の承認と同じ判断で範囲を分ける)。
create table if not exists persona_loans (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  scope text not null check (scope in ('same_school', 'cross_org')),
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (persona_id, project_id)
);

-- B10. F26: 学習者本人の横断プロファイルを、版で重ねる(最新1件の上書きをやめる)。
--   新しい分だけを足して要約する(based_on_version = 前の版)ので、入力が際限なく長くならない。
create table if not exists learner_profile_versions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  version int not null,
  based_on_version int,
  covers_until timestamptz,
  strengths text,
  challenges text,
  summary text,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (student_id, version)
);

alter table inquiry_trajectories enable row level security;
alter table inquiry_stage_stories enable row level security;
alter table inquiry_episodes enable row level security;
alter table inquiry_episode_versions enable row level security;
alter table inquiry_sources enable row level security;
alter table persona_archives enable row level security;
alter table persona_versions enable row level security;
alter table persona_loans enable row level security;
alter table learner_profile_versions enable row level security;

-- 埋め込み検索の索引は、エピソードが貯まってから作る(件数が少ないうちは全件走査で足りる)。
--   create index inquiry_episode_versions_embedding_idx
--     on inquiry_episode_versions using hnsw (embedding vector_cosine_ops) where kind = 'narrated';

-- ============================================================================
-- Part C: 既存データの移し替え(0043)
-- ============================================================================

-- C1. 「授業の控え」を、いまの授業回の名前から埋める。
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

-- C2. 既存の記録を、「学習者 × シリーズ」ごとの個人プロジェクト(kind='solo')に束ねる。
--   人間のグループがまだ無いので、いまの記録はすべて1人のプロジェクトになる。
--   (シリーズ, 学習者)ごとに1つだけ作るため、一時的な対応表を使う。
create temp table _proj_map on commit drop as
select series_id, student_id, gen_random_uuid() as project_id
from (
  select c.series_id, ls.student_id
  from learning_sessions ls join courses c on c.id = ls.course_id
  where ls.student_id is not null and ls.project_id is null
  union
  select c.series_id, s.student_id
  from submissions s join courses c on c.id = s.course_id
  where s.project_id is null
) x;

insert into inquiry_projects (id, series_id, owner_teacher_id, kind, title, fiscal_year, series_label)
select m.project_id, m.series_id, cs.owner_teacher_id, 'solo', cs.title, cs.fiscal_year, cs.title
from _proj_map m join course_series cs on cs.id = m.series_id;

insert into inquiry_project_members (project_id, student_id)
select project_id, student_id from _proj_map;

-- C3. 記録をプロジェクトに紐づける。
update learning_sessions ls
set project_id = m.project_id
from _proj_map m join courses c on c.series_id = m.series_id
where ls.course_id = c.id and ls.student_id = m.student_id and ls.project_id is null;

update submissions s
set project_id = m.project_id
from _proj_map m join courses c on c.series_id = m.series_id
where s.course_id = c.id and s.student_id = m.student_id and s.project_id is null;

-- C4. F26の既存の横断プロファイルを、版1として移す(生成方法は「全件の連結」だったことを記録する)。
insert into learner_profile_versions (student_id, version, strengths, challenges, summary, model, prompt_version, created_at)
select student_id, 1, strengths, challenges, summary, null, 'legacy-full-concat', coalesce(generated_at, created_at)
from learner_profiles
where status = 'done'
on conflict (student_id, version) do nothing;

-- C5. 既存のペルソナを、版1として保存する(版の履歴の起点)。
insert into persona_versions (persona_id, version, snapshot, note, created_at)
select id, 1, jsonb_build_object('name', name, 'profile', profile, 'stance', stance, 'behavior_rules', behavior_rules),
       'migrated from personas', created_at
from personas
on conflict (persona_id, version) do nothing;

-- C6. 既存の learner_corpus_entries は、出典を持たないため②には移さない(旧データとして残す)。
--   ①が残っているので、新しい抽出パイプラインで①から作り直す。
