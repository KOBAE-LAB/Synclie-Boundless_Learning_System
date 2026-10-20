-- 学習の流れ(インプットとアウトプットの設計)。
-- 教師が授業ごとに「インプット(動画・資料を見る時間)」と「アウトプット(擬似メンバーと議論して深める時間)」
-- のステップを自由に並べる。ステップが1つも無い授業は、これまでどおり(議論だけ)で動く。
--
-- course_steps: 授業のステップ。インプットには動画URL(YouTube等)と資料(course_materials)、
--   理解チェックの問い(check_questions: [{question, answerPoints, evidence}])を持てる。
-- step_progress: 学習者がそのステップを終えた記録(インプットでは、理解チェックへの本人の答えも)。
-- courses.steps_in_order: ステップを順番どおりに進める(インプットが終わるまで議論に入れない)か。
create table if not exists course_steps (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  position int not null,
  kind text not null check (kind in ('input', 'output')),
  title text not null,
  instruction text not null default '',
  material_id uuid references course_materials(id) on delete set null,
  video_url text,
  minutes int check (minutes between 1 and 240),
  check_questions jsonb,
  created_at timestamptz not null default now()
);
create index if not exists course_steps_course_position_idx on course_steps (course_id, position);
alter table course_steps enable row level security;

create table if not exists step_progress (
  student_id uuid not null references profiles(id) on delete cascade,
  step_id uuid not null references course_steps(id) on delete cascade,
  completed_at timestamptz not null default now(),
  answers jsonb,
  primary key (student_id, step_id)
);
alter table step_progress enable row level security;

alter table courses add column if not exists steps_in_order boolean not null default true;
