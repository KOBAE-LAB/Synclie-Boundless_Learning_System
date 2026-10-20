-- 教師ダッシュボードの「指導のヒント」(AIの提案)。授業ごとに最新の1件だけを保存する。
-- 教師が明示的に押したときだけ生成する(AI呼び出しを自動化しない)。提案にとどめ、判断は教師。
create table if not exists teacher_guidance (
  course_id uuid primary key references courses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  error text,
  content jsonb,
  generated_at timestamptz
);
alter table teacher_guidance enable row level security;
