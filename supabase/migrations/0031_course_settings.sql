-- 授業設定の拡張。擬似メンバーの発言と、AIによるペルソナ推薦の両方の手がかりにする。
--   objective        授業のねらい・議題(何を議論し、何を学ぶ授業か)
--   learner_level    学習者の校種・学年(言葉づかいや、ペルソナの年齢感の目安)
--   discussion_style 討論の型: opposing(対立型)/collaborative(協調型)/teaching(教え合い型)。未設定=指定なし
--   ai_member_count  AI擬似メンバーの目標人数(使用中の人数との差を、教師画面で知らせる)
alter table courses
  add column if not exists objective text,
  add column if not exists learner_level text,
  add column if not exists discussion_style text
    check (discussion_style is null or discussion_style in ('opposing', 'collaborative', 'teaching')),
  add column if not exists ai_member_count smallint
    check (ai_member_count is null or ai_member_count between 1 and 5);
