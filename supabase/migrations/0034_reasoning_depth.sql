-- 擬似メンバーの発言を作るAIの「推論の深さ」(授業ごと)。
--   fast=速さ優先(浅く) / standard=標準(モデルの既定) / deep=じっくり(深く。遅く、費用も増える)
-- 論証評価・議論のまとめ・状態判定など、研究の計測や補助の呼び出しには適用しない(固定のまま)。
alter table courses
  add column if not exists reasoning_depth text not null default 'standard'
    check (reasoning_depth in ('fast', 'standard', 'deep'));
