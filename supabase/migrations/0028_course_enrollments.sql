-- F01拡張: 受講登録。「教師が開設した授業コードと学習者をつなげる仕組みが無い」
-- (段階1は/learnが全授業を無条件表示していた)という指摘への対応。
--
-- courses.join_code: 教師が生徒に伝える短い参加コード。既存の授業にも自動で振る
-- (デフォルト式で新規作成時にも自動生成される)。
alter table courses
  add column if not exists join_code text unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
update courses set join_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  where join_code is null;
alter table courses alter column join_code set not null;

-- course_enrollments: どの学習者がどの授業に参加登録しているか。
create table if not exists course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, student_id)
);
alter table course_enrollments enable row level security;

-- 既にそのペア(授業・学習者)で対話が始まっている場合は、突然使えなくならないよう
-- 参加登録済み扱いにしておく(この機能導入前から対話していた学習者を締め出さないため)。
insert into course_enrollments (course_id, student_id)
select distinct course_id, student_id from learning_sessions
on conflict (course_id, student_id) do nothing;
