-- ③投射層のうち、同じ学校の「先輩型」ペルソナ(要件定義書14章の実装(2b-1)、2026-10-22)。
--   先輩の探究プロジェクトの②(軌跡・段階の物語・エピソード)から、AIがペルソナの下書きを作り、教師が承認する。
--   承認した先輩型は、同じ学校(組織)の授業回に「貸し出し」て使う(参照だけで、元のペルソナと②は書き換えない)。
--   発言のたびに、後輩の発言にいちばん近いエピソード1件を親(段階の物語)と一緒に添え、使った記録を残す。
--   他校型(組織をまたぐ貸し出し・他校向けの匿名化の版)は (2b-2) で入れる(ここでは種類の値だけ用意する)。

-- ---------------------------------------------------------------------------
-- 1. ペルソナの種類と、先輩型の出どころ
-- ---------------------------------------------------------------------------
alter table personas drop constraint if exists personas_tier_check;
alter table personas
  add constraint personas_tier_check
  check (tier in ('teacher_defined', 'rag_initial', 'evolved', 'senior', 'other_school'));

alter table personas
  -- 先輩型の材料になった探究プロジェクト。プロジェクトが消えたら(学習者本人の全データ削除など)、ペルソナも消す。
  add column if not exists source_project_id uuid references inquiry_projects(id) on delete cascade,
  -- 先輩型を作った教師と、その組織(=アーカイブの単位。「同じ学校」の判定に使う)。授業回には属さない(course_id は null)。
  add column if not exists created_by uuid references profiles(id) on delete set null,
  add column if not exists organization_id uuid references organizations(id) on delete set null,
  -- 教師が付ける呼び名と、先輩の年度(名前「2025年度の先輩 ミナト(AI)」の材料)
  add column if not exists nickname text,
  add column if not exists source_fiscal_year int,
  -- いまの版の番号(persona_versions)
  add column if not exists current_version int not null default 0;
create index if not exists personas_source_project_idx on personas (source_project_id);
create index if not exists personas_archive_idx on personas (organization_id, created_by) where course_id is null;

-- ---------------------------------------------------------------------------
-- 2. ペルソナの版(要件定義書6章「各版を保存」)。名前・プロフィール・立場・行動ルールが変わるたびに、トリガーで積む。
--    アプリのどこからペルソナを作っても・直しても漏れないよう、DBで行う。
-- ---------------------------------------------------------------------------
create table if not exists persona_versions (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (persona_id, version)
);

-- 既存のペルソナを版1として保存する(版の履歴の起点)。
insert into persona_versions (persona_id, version, snapshot, created_at)
select id, 1, jsonb_build_object('name', name, 'profile', profile, 'stance', stance, 'behavior_rules', behavior_rules), created_at
from personas
on conflict (persona_id, version) do nothing;
update personas set current_version = 1 where current_version = 0;

create or replace function personas_snapshot_version() returns trigger language plpgsql as $$
declare
  next_version int;
begin
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.profile is not distinct from old.profile
     and new.stance is not distinct from old.stance
     and new.behavior_rules is not distinct from old.behavior_rules then
    return new;
  end if;
  next_version := coalesce((select max(version) from persona_versions where persona_id = new.id), 0) + 1;
  insert into persona_versions (persona_id, version, snapshot)
  values (new.id, next_version,
          jsonb_build_object('name', new.name, 'profile', new.profile, 'stance', new.stance, 'behavior_rules', new.behavior_rules));
  update personas set current_version = next_version where id = new.id and current_version is distinct from next_version;
  return new;
end $$;
drop trigger if exists personas_snapshot_version on personas;
create trigger personas_snapshot_version after insert or update on personas
  for each row execute function personas_snapshot_version();

-- どの版が、どの発言をしたか(発言を保存したときの版を、トリガーで書く)。
alter table dialogue_turns
  add column if not exists persona_version_id uuid references persona_versions(id) on delete set null;

create or replace function dialogue_turns_stamp_persona_version() returns trigger language plpgsql as $$
begin
  if new.persona_id is not null and new.persona_version_id is null then
    select v.id into new.persona_version_id
    from personas p join persona_versions v on v.persona_id = p.id and v.version = p.current_version
    where p.id = new.persona_id;
  end if;
  return new;
end $$;
drop trigger if exists dialogue_turns_stamp_persona_version on dialogue_turns;
create trigger dialogue_turns_stamp_persona_version before insert on dialogue_turns
  for each row execute function dialogue_turns_stamp_persona_version();

-- ---------------------------------------------------------------------------
-- 3. 貸し出し: 承認した先輩型を、授業回で使う(参照だけ)。モード(当時/振り返り)は貸し出しごとに教師が選ぶ。
-- ---------------------------------------------------------------------------
create table if not exists persona_loans (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  mode text not null default 'then' check (mode in ('then', 'retrospective')),
  scope text not null default 'same_school' check (scope in ('same_school', 'cross_org')),
  -- active = 使用中、paused = いまは使わない(行は残す)。組織をまたぐ承認待ち(pending)は (2b-2) で使う。
  status text not null default 'active' check (status in ('active', 'paused', 'pending')),
  created_by uuid references profiles(id) on delete set null,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (persona_id, course_id)
);
create index if not exists persona_loans_course_idx on persona_loans (course_id);

-- ---------------------------------------------------------------------------
-- 4. 検索の記録: 先輩型の発言ごとに、使った記録(軌跡・段階の物語・エピソードの版)と順位を残す。
--    ②が作り直されて消えても、発言の行は残る(参照は null になる)。
-- ---------------------------------------------------------------------------
create table if not exists dialogue_turn_retrievals (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references dialogue_turns(id) on delete cascade,
  persona_id uuid references personas(id) on delete set null,
  kind text not null check (kind in ('trajectory', 'stage_story', 'episode')),
  trajectory_id uuid references inquiry_trajectories(id) on delete set null,
  stage_story_id uuid references inquiry_stage_stories(id) on delete set null,
  episode_version_id uuid references inquiry_episode_versions(id) on delete set null,
  mode text check (mode in ('then', 'retrospective')),
  rank int,
  similarity real,
  created_at timestamptz not null default now()
);
create index if not exists dialogue_turn_retrievals_turn_idx on dialogue_turn_retrievals (turn_id);

-- ---------------------------------------------------------------------------
-- 5. エピソードの検索(教材RAGの match_material_chunks と同じ形)。プロジェクト・段階の範囲・使う版で絞る。
-- ---------------------------------------------------------------------------
create or replace function match_inquiry_episodes(
  p_project_id uuid,
  p_stage_keys text[],
  p_kind text,
  p_query_embedding vector(1536),
  p_match_count int default 1
)
returns table (episode_id uuid, version_id uuid, stage_key text, seq int, context_header text, body text, similarity float)
language sql
stable
as $$
  select e.id, v.id, e.stage_key, e.seq, v.context_header, v.body,
         1 - (v.embedding <=> p_query_embedding) as similarity
  from inquiry_episodes e
  join lateral (
    select * from inquiry_episode_versions v
    where v.episode_id = e.id and v.kind = p_kind and v.embedding is not null
    order by v.version desc
    limit 1
  ) v on true
  where e.project_id = p_project_id
    and (p_stage_keys is null or e.stage_key = any (p_stage_keys))
  order by v.embedding <=> p_query_embedding
  limit p_match_count;
$$;
revoke all on function public.match_inquiry_episodes(uuid, text[], text, vector, integer) from public, anon, authenticated;
grant execute on function public.match_inquiry_episodes(uuid, text[], text, vector, integer) to service_role;
-- トリガー関数は直接呼べない(returns trigger)ので、実行権限はそのままにする。

alter table persona_versions enable row level security;
alter table persona_loans enable row level security;
alter table dialogue_turn_retrievals enable row level security;
revoke all on persona_versions, persona_loans, dialogue_turn_retrievals from anon, authenticated;
