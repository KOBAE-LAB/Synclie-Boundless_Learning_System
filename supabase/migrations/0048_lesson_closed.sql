-- 授業回の「終了」(2026-10-23、先生の指摘: 準備中・公開はあるが、終了が無い)。
--   授業回は 準備中(released=false)→ 公開中(released=true)→ 終了(closed_at が入る)。終了した授業回は、学習者は記録を見返せるが、
--   新しい発言・提出・インプットの完了はできない(教科・科目の「終了」(archived_at)と同じ扱い)。先生はいつでも再開できる(closed_at を null に戻す)。
--   データは消さない。列の追加だけ。
alter table courses add column if not exists closed_at timestamptz;
