-- 管理者が「学習者として表示」で使う、専用のテスト学習者。
-- profiles.test_owner_id: このプロファイルは、その管理者のテスト用の学習者(1人につき1つ)。
-- パスワード・メールアドレスを持たない(ログインはできず、管理者の切り替え機能からだけ使われる)。
-- 管理者アカウントが消えれば、テスト学習者も一緒に消える(on delete cascade)。
alter table profiles
  add column if not exists test_owner_id uuid references profiles(id) on delete cascade;

create unique index if not exists profiles_test_owner_unique
  on profiles(test_owner_id) where test_owner_id is not null;
