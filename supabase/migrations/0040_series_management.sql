-- 授業シリーズの管理(全回数・年度・アーカイブ)。
--   planned_lessons: 「全◯回」の予定回数(表示用。任意)
--   fiscal_year:     年度(4月始まり、日本時間)。一覧を年度で絞り込む。年度末の引き継ぎ(複製)で次の年度に移す
--   archived_at:     年度末などに閉じたシリーズ。新規の履修登録・発言・提出は受け付けず、記録は見返せる
alter table course_series
  add column if not exists planned_lessons int check (planned_lessons between 1 and 60),
  add column if not exists fiscal_year int,
  add column if not exists archived_at timestamptz;

update course_series
set fiscal_year = extract(year from ((created_at at time zone 'Asia/Tokyo') - interval '3 months'))::int
where fiscal_year is null;

alter table course_series alter column fiscal_year set not null;
