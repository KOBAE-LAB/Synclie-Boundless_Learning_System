-- 学習(議論)の「終わり」。これまでセッションには終了の仕組みが無く(ended_atは誰も設定していなかった)、
-- 議論は際限なく続いた。制限時間・AIによる「まとめ」の提案・終了時のまとめを入れる。
--
-- courses(教師が決める設定):
--   time_limit_minutes             制限時間(分)。最初の発言からの経過で数える。null=制限なし
--   time_limit_policy              soft=超過しても続けられる(記録のみ) / hard=超過したら発言を止めて、まとめへ
--   time_limit_affects_evaluation  時間超過を評価の参考にするか(学習者の画面には表示のみ。テンポ設定と同じ考え方)
--   ai_close_suggestion            AIが議論の状態(収束・堂々めぐり・脱線)を見て、まとめを提案するか
-- learning_sessions(1回の議論の記録):
--   end_reason                     終わった理由(time_limit=時間切れ / ai_suggested=AIの提案に応じた / student=本人)
--   closing_summary                終了時のAIのまとめ({summary, keyPoints[], nextQuestions[]})
--   close_suggested_at / close_suggestion_reason  AIが「まとめましょう」と提案した時刻と理由
--   close_suggest_after_turn       この発言数に達するまでは、提案しない(「もう少し続ける」を選んだ後の間隔)
alter table courses
  add column if not exists time_limit_minutes smallint
    check (time_limit_minutes is null or time_limit_minutes between 5 and 240),
  add column if not exists time_limit_policy text not null default 'soft'
    check (time_limit_policy in ('soft', 'hard')),
  add column if not exists time_limit_affects_evaluation boolean not null default false,
  add column if not exists ai_close_suggestion boolean not null default true;

alter table learning_sessions
  add column if not exists end_reason text
    check (end_reason is null or end_reason in ('time_limit', 'ai_suggested', 'student')),
  add column if not exists closing_summary jsonb,
  add column if not exists close_suggested_at timestamptz,
  add column if not exists close_suggestion_reason text,
  add column if not exists close_suggest_after_turn integer not null default 4;
