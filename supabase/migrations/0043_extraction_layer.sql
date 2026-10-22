-- データ基盤の再設計(要件定義書14章)の実装(2a): ②抽出層と、それを作るための印・処理待ち・段階、AIの使用量の記録。
-- 草案 docs/drafts/0042_data_foundation_draft.sql の Part B のうち②の部分(B1〜B5)に、ステップ5・6の決定で足したものを加えた。
-- ③投射層(アーカイブ・ペルソナの版・貸し出し・検索の記録)とF26の版は、実装(2b)の 0044 で入れる。
--
-- 方針:
--   ② は版で重ねる(上書きしない)。すべての行が出典(①)をたどれる。
--   ② は授業ではなく探究プロジェクトに属する。①の対話セッションが消えると(学習者本人の全データ削除・テストデータの消去)、
--   そこから作ったエピソードも連鎖して消える(session_id の on delete cascade)。
--   既存のデータは変更しない(テーブルと列の追加だけ)。

-- ============================================================================
-- AIの使用量の記録(14章「使用量の記録と上限」、12章「コスト上限の監視」)
-- ============================================================================
create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- 金額の目安(米ドル)。単価が分からないモデルは null。請求額そのものではない。
  cost_usd numeric(12, 6),
  course_id uuid references courses(id) on delete set null,
  project_id uuid references inquiry_projects(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_created_idx on ai_usage_log (created_at);
create index if not exists ai_usage_log_course_idx on ai_usage_log (course_id, created_at);

-- ============================================================================
-- 段階: 授業回の「想定の段階」と、プロジェクトのいまの段階・切り替えの記録(ステップ5の決定)
--   段階の鍵は、既定の4段階(problem_setting / information_gathering / analysis / expression)。
--   プロジェクトが独自の段階(stage_set)を持つ場合も、canonical で既定の4段階に対応づける。
-- ============================================================================
alter table courses add column if not exists expected_stage_key text;
alter table inquiry_projects add column if not exists current_stage_key text;

create table if not exists inquiry_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  from_stage_key text,
  to_stage_key text not null,
  -- teacher_expected: 授業回の想定の段階に合わせて自動で / learner: 学習者が宣言 / teacher: 教師が変更
  decided_by text not null check (decided_by in ('teacher_expected', 'learner', 'teacher')),
  decided_by_profile uuid references profiles(id) on delete set null,
  course_id uuid references courses(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_stage_transitions_project_idx on inquiry_stage_transitions (project_id, created_at);

-- ============================================================================
-- 印: 対話の最中に、AIを呼ばずに付ける「この場面は大事」の目印(ステップ5の決定)
-- ============================================================================
create table if not exists inquiry_markers (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references dialogue_turns(id) on delete cascade,
  session_id uuid not null references learning_sessions(id) on delete cascade,
  -- evidence_shift: 論証評価で新しい根拠あり / persona_conceded: 擬似メンバーが譲歩
  -- student_keep: 学習者の「後輩に残したい」 / teacher_mark: 教師の印
  kind text not null check (kind in ('evidence_shift', 'persona_conceded', 'student_keep', 'teacher_mark')),
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (turn_id, kind)
);
create index if not exists inquiry_markers_session_idx on inquiry_markers (session_id);

-- ============================================================================
-- 処理待ち: 後処理(Next.js の after())で行う抽出の仕事。cronは使わない。
-- ============================================================================
create table if not exists inquiry_jobs (
  id uuid primary key default gen_random_uuid(),
  -- extract_session: 議論からエピソードを作る / build_stage_story: 段階の物語(当時版)と軌跡 / build_retrospective: 振り返り版
  kind text not null check (kind in ('extract_session', 'build_stage_story', 'build_retrospective')),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  session_id uuid references learning_sessions(id) on delete cascade,
  stage_key text,
  prompt_version text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'skipped', 'deferred')),
  attempts int not null default 0,
  error text,
  -- 同じ対象を、同じプロンプトの版で二重に処理しないための鍵
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inquiry_jobs_status_idx on inquiry_jobs (status, created_at);
create index if not exists inquiry_jobs_project_idx on inquiry_jobs (project_id);

-- ============================================================================
-- ② 抽出層
-- ============================================================================

-- 軌跡: プロジェクト全体の物語。版で重ねる。live は段階が終わるたびに(その段階までの記録だけで)、
-- retrospective は探究の終了後に作る。up_to_stage_key は「どの段階までを含む版か」(当時モードの絞り込みに使う)。
create table if not exists inquiry_trajectories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  kind text not null default 'live' check (kind in ('live', 'retrospective')),
  version int not null,
  up_to_stage_key text,
  body text not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (project_id, kind, version)
);

-- 段階の物語: 段階ごとの「何に迷い、何を決めたか」。live = その段階の終わりに、その場の視点で / retrospective = 探究の終了後に。
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

-- エピソード: 意味のある1場面。RAGの検索単位。前後と親(段階の物語)を参照して、文脈ごと引ける。
create table if not exists inquiry_episodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references inquiry_projects(id) on delete cascade,
  -- 元の議論。学習者本人の全データ削除などでセッションが消えると、エピソードも消える
  session_id uuid references learning_sessions(id) on delete cascade,
  stage_key text not null,
  -- 種類(ステップ2の決定): question_shift / hypothesis_rejected / stuck / turning_point / discovery。
  -- 実データを見て増減するため、check制約にせず text で持つ。
  episode_type text not null,
  seq int not null,
  prev_episode_id uuid references inquiry_episodes(id) on delete set null,
  parent_story_id uuid references inquiry_stage_stories(id) on delete set null,
  -- プロジェクト内の相対時期(プロジェクト開始からの日数、授業回の番号)
  relative_day int,
  lesson_no int,
  picked_by text not null default 'auto' check (picked_by in ('auto', 'student', 'teacher')),
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (project_id, seq)
);
create index if not exists inquiry_episodes_stage_idx on inquiry_episodes (project_id, stage_key);
create index if not exists inquiry_episodes_session_idx on inquiry_episodes (session_id);

-- エピソードの版: excerpt = 発言からそのまま切り出した原文 / narrated = 校内向けに匿名化した一人称の語り /
-- narrated_cross_org = 他校向け(学校名・地名・特定できる出来事もぼかす。他校へ貸し出すときだけ作る)。
-- 検索の埋め込みは語りの版に持たせる。
create table if not exists inquiry_episode_versions (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references inquiry_episodes(id) on delete cascade,
  kind text not null check (kind in ('excerpt', 'narrated', 'narrated_cross_org')),
  version int not null,
  body text not null,
  -- 検索用の見出し(「〇〇をテーマにした探究の、課題設定の2週目、仮説を捨てた場面」)。埋め込みは見出し+本文から作る
  context_header text,
  embedding vector(1536),
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (episode_id, kind, version)
);

-- 出典: ②のすべての行が、どの①から作られたかを持つ。多態の参照のため外部キーは張らず、アプリが整合を守る。
create table if not exists inquiry_sources (
  id uuid primary key default gen_random_uuid(),
  derived_kind text not null check (derived_kind in ('trajectory', 'stage_story', 'episode', 'episode_version')),
  derived_id uuid not null,
  source_kind text not null check (source_kind in ('dialogue_turn', 'submission', 'reflection', 'argument_evaluation', 'episode', 'stage_story')),
  source_id uuid not null,
  role text,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_sources_derived_idx on inquiry_sources (derived_kind, derived_id);
create index if not exists inquiry_sources_source_idx on inquiry_sources (source_kind, source_id);

-- 埋め込み検索の索引は、エピソードが貯まってから作る(件数が少ないうちは全件走査で足りる)。
--   create index inquiry_episode_versions_embedding_idx
--     on inquiry_episode_versions using hnsw (embedding vector_cosine_ops) where kind = 'narrated';

alter table ai_usage_log enable row level security;
alter table inquiry_stage_transitions enable row level security;
alter table inquiry_markers enable row level security;
alter table inquiry_jobs enable row level security;
alter table inquiry_trajectories enable row level security;
alter table inquiry_stage_stories enable row level security;
alter table inquiry_episodes enable row level security;
alter table inquiry_episode_versions enable row level security;
alter table inquiry_sources enable row level security;
revoke all on ai_usage_log, inquiry_stage_transitions, inquiry_markers, inquiry_jobs, inquiry_trajectories,
  inquiry_stage_stories, inquiry_episodes, inquiry_episode_versions, inquiry_sources from anon, authenticated;

-- 月の使用金額の合計(上限の判定用)。行が多くなるので、アプリで全件を読まずにDBで合計する。
-- 0041の方針どおり、service_role だけに実行を許す。
create or replace function ai_usage_cost_since(p_since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_usd), 0) from ai_usage_log where created_at >= p_since;
$$;
revoke all on function ai_usage_cost_since(timestamptz) from public, anon, authenticated;
grant execute on function ai_usage_cost_since(timestamptz) to service_role;

-- 使用量の要約(教師ダッシュボード用)。p_course_id が null なら全体。
create or replace function ai_usage_summary_since(p_since timestamptz, p_course_id uuid default null)
returns table (calls bigint, input_tokens bigint, cached_input_tokens bigint, output_tokens bigint, cost_usd numeric)
language sql
stable
as $$
  select count(*), coalesce(sum(input_tokens), 0), coalesce(sum(cached_input_tokens), 0),
         coalesce(sum(output_tokens), 0), coalesce(sum(cost_usd), 0)
  from ai_usage_log
  where created_at >= p_since and (p_course_id is null or course_id = p_course_id);
$$;
revoke all on function ai_usage_summary_since(timestamptz, uuid) from public, anon, authenticated;
grant execute on function ai_usage_summary_since(timestamptz, uuid) to service_role;
