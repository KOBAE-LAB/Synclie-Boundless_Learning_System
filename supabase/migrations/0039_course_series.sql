-- 授業シリーズ(科目・講座)と授業回の階層。
--
-- これまでの「授業」(courses)は平らな1段で、複数回の授業を重ねる置き場が無かった。
--   授業シリーズ(course_series): 教師が担当し、学習者が履修登録する単位(例: 「理科1年 光合成」)。
--   授業回(courses): シリーズの中の1回(第1回、第2回…)。資料・ペルソナ・学習の流れ・議論・提出は回ごとに持つ。
-- 履修登録(参加コード・申請・承認)だけをシリーズに持たせる。
create table if not exists course_series (
  id uuid primary key default gen_random_uuid(),
  owner_teacher_id uuid not null references profiles(id),
  title text not null,
  subject text,
  join_code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  created_at timestamptz not null default now()
);
alter table course_series enable row level security;

create table if not exists series_enrollments (
  series_id uuid not null references course_series(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'approved' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now(),
  primary key (series_id, student_id)
);
alter table series_enrollments enable row level security;

-- 授業回: courses を回として使う。released=false の間は、学習者には見えない(準備中)。
alter table courses
  add column if not exists series_id uuid references course_series(id) on delete cascade,
  add column if not exists lesson_no int,
  add column if not exists released boolean not null default false;

-- 既存の授業は、同じ名前のシリーズの「第1回(公開済み)」に移す。参加コード・履修・記録はそのまま引き継ぐ。
create temp table _series_map on commit drop as
  select id as course_id, gen_random_uuid() as series_id from courses where series_id is null;

insert into course_series (id, owner_teacher_id, title, subject, join_code)
select m.series_id, c.owner_teacher_id, c.title, c.subject, c.join_code
from courses c join _series_map m on m.course_id = c.id
where c.owner_teacher_id is not null;

update courses c set series_id = m.series_id, lesson_no = 1, released = true
from _series_map m
where m.course_id = c.id
  and exists (select 1 from course_series s where s.id = m.series_id);

insert into series_enrollments (series_id, student_id, status, created_at)
select m.series_id, e.student_id, e.status, e.created_at
from course_enrollments e join _series_map m on m.course_id = e.course_id
where exists (select 1 from course_series s where s.id = m.series_id)
on conflict do nothing;

-- 担当教師が無い授業(あれば)は、シリーズを作れないので削除する(テストデータのみの想定)。
delete from courses where series_id is null;

alter table courses
  alter column series_id set not null,
  alter column lesson_no set not null;
create unique index if not exists courses_series_lesson_no_idx on courses (series_id, lesson_no);

-- 履修は、シリーズ側に移した。
alter table courses drop column if exists join_code;
drop table if exists course_enrollments;
