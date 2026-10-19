-- 擬似メンバーの発言の活発さ。学習者の発言のあと、擬似メンバーが続けて何人まで(何発言まで)
-- 話してよいかの上限を決める。quiet=最大2発言 / normal=最大3発言 / lively=最大4発言。
-- 実際に誰が・何回話すかは、各メンバーの性格・視点・発言頻度・介入の条件から、AIが場面ごとに決める。
alter table courses
  add column if not exists discussion_liveliness text not null default 'normal'
    check (discussion_liveliness in ('quiet', 'normal', 'lively'));
