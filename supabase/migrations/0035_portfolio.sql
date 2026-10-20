-- ポートフォリオ(学習者本人の「学びのデータベース」)。
--
-- 成果・フィードバック・ジャッジ・振り返り・議論のまとめは、既存のテーブルをそのまま使い、
-- ポートフォリオ画面が束ねて見せる(コピーは作らない)。ここで新しく持つのは次の2つだけ。
--
-- 1) portfolio_entries(0001から骨組みだけあり、使われていなかった): 成果1件ごとの記録。
--      self_assessment    学習者本人の自己評価 {rating: 1〜4, comment, updatedAt}
--      teacher_assessment 教師のコメント {rating?, comment, updatedAt}(AIの評価は材料にとどめ、最終判断は人間)
--      shared             本人が「公開用」に選んだか(公開リンクで見せる対象)
-- 2) portfolio_share_links: 本人が作る、期限つき・取り消せる公開リンク。リンクを知っている人は、
--    公開用に選んだ成果だけを、ログインなしで見られる。
alter table portfolio_entries
  add column if not exists submission_id uuid references submissions(id) on delete cascade,
  add column if not exists shared boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists portfolio_entries_submission_unique
  on portfolio_entries (submission_id) where submission_id is not null;

create table if not exists portfolio_share_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portfolio_share_links_student_idx on portfolio_share_links (student_id);
alter table portfolio_share_links enable row level security;
