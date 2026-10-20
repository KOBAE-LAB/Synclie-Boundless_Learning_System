-- 学習の流れ: インプットのステップに、アップロードした動画ファイル(Storageの materials バケット内)を持てるようにする。
alter table course_steps add column if not exists video_path text;
