-- 先輩のAI(先輩型・集約型)を、同じ学校をこえて使えるようにする土台(「他校型」の代わりの設計、2026-10-25)。
--   他校型という別の種類は作らず、(1)組織に種類と親子(学校→自治体)、学校をまたぐ「連携グループ」を持たせ、
--   (2)先輩のAIごとに「公開範囲」(自分だけ/同じ学校/同じ自治体/連携グループ)を選べるようにする。
--   広い範囲に出すには、所属の確かさ(verified)・組織の承認者の承認・学習者の別の同意・特定されにくくした版が要る。
-- このマイグレーションは列とテーブルの追加と、同意の一意キーの付け替えだけで、既存のデータは消さない。
-- 既定は今までどおり(公開範囲=同じ学校)なので、動作は変わらない。

-- ============================================================================
-- 1. 組織の種類と階層。verified = 所属が確かな組織(SSOのテナントから作られた組織、または管理者が確かめた組織)。
-- ============================================================================
alter table organizations
  add column if not exists kind text not null default 'school' check (kind in ('school', 'municipality', 'other')),
  add column if not exists parent_organization_id uuid references organizations(id) on delete set null,
  add column if not exists verified boolean not null default false;
update organizations set verified = true where sso_tenant_id is not null and verified = false;
alter table organizations drop constraint if exists organizations_not_own_parent;
alter table organizations add constraint organizations_not_own_parent check (parent_organization_id is distinct from id);
create index if not exists organizations_parent_idx on organizations (parent_organization_id);

-- 連携グループ: 学校や自治体をまたぐ任意の集まり(研究会・離島ネットワークなど)。探究学習の「学習者のグループ」とは別のもの。
create table if not exists organization_networks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists organization_network_members (
  network_id uuid not null references organization_networks(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (network_id, organization_id)
);
create index if not exists organization_network_members_org_idx on organization_network_members (organization_id);

alter table organization_networks enable row level security;
alter table organization_network_members enable row level security;
revoke all on organization_networks, organization_network_members from anon, authenticated;

-- ============================================================================
-- 2. 先輩のAIの公開範囲。share_scope は「いま有効な範囲」。広げる申請(scope_request)は、組織の承認者が承認して初めて有効になる。
--    private = 作った先生だけ / school = 同じ学校(組織)の先生(今までどおり) / municipality = 同じ自治体の学校 / network = 連携グループの学校
-- ============================================================================
alter table personas
  add column if not exists share_scope text not null default 'school' check (share_scope in ('private', 'school', 'municipality', 'network')),
  add column if not exists share_network_id uuid references organization_networks(id) on delete set null,
  add column if not exists scope_request text check (scope_request in ('municipality', 'network')),
  add column if not exists scope_request_network_id uuid references organization_networks(id) on delete set null,
  add column if not exists scope_requested_at timestamptz;

-- ============================================================================
-- 3. 同意を種類ごとに持つ。data_use = 今までのデータ利用への同意 / share_wide = 自分の探究の記録を、他の学校で使う
--    先輩のAIの材料にすることへの、別の同意。学習者1人1行(unique(student_id))を、(学習者, 種類)ごとに1行へ付け替える。
-- ============================================================================
alter table consent_records drop constraint if exists consent_records_student_id_key;
create unique index if not exists consent_records_student_scope_key on consent_records (student_id, scope);

-- ============================================================================
-- 4. 他校向けに特定されにくくした版の作成(処理待ち)
-- ============================================================================
alter table inquiry_jobs drop constraint if exists inquiry_jobs_kind_check;
alter table inquiry_jobs
  add constraint inquiry_jobs_kind_check
  check (kind in ('extract_session', 'build_stage_story', 'build_retrospective', 'anonymize_episodes'));
