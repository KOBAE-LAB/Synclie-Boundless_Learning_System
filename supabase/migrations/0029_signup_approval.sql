-- サインアップ(自己登録)と承認制。
--
-- profiles.approval_status: 教師の自己登録は管理者の承認が済むまで 'pending' のままで、
-- ログインできない。SSO/LTI経由や既存アカウントは従来どおり 'approved'(既定値)。
-- profiles.is_admin: 教師の承認ができる管理者。教師アカウントの1つに立てる(別ロールは作らない)。
alter table profiles
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists is_admin boolean not null default false;

-- course_enrollments.status: 学習者が授業コードで申請しただけの段階は 'pending'、
-- 教師が承認する(または教師が直接登録する)と 'approved'。既存の参加登録は承認済み扱い。
-- 'pending' の間は、授業画面にも対話にも入れない(AI呼び出しの課金が発生しない)。
alter table course_enrollments
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved'));
