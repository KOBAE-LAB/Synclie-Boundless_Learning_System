-- 公開API(PostgRESTの anon / authenticated)からの直接アクセスを、権限ごと塞ぐ。
--
-- このアプリは、Supabase Authを使わず(認証はAuth.js)、DBへは常にサーバー側から service_role キーで
-- 接続する。anon / authenticated(ブラウザや公開APIから使われる役割)には、何の権限も要らない。
-- これまでは、RLSを有効にしてポリシーを置かない(=すべて拒否)ことだけが防壁だった。Supabaseは、
-- 新しいテーブルに anon / authenticated への全権限を既定で付けるため、テーブルを足すときに
-- RLSを有効にし忘れると、そのテーブルが公開APIから丸見えになる。権限を外しておけば、忘れても漏れない。
--
-- なお、行ごとのRLSポリシー(「この教師はこの授業だけ」など)は、利用者がSupabaseの利用者ではない
-- (auth.uid() で本人を特定できない)ため、書けない。アクセスの制御は、アプリ側の
-- requireRole / assertOwnsCourse / requireEnrollment などで行う(CLAUDE.md 認証まわりの注意)。
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 関数の実行権限は、既定で全員(PUBLIC)に付くため、anon / authenticated から外すだけでは足りない。
-- アプリが公開APIとして使う関数(授業RAGの検索)は、PUBLICからも外し、service_role だけに許す。
-- (pgvectorの内部関数は、検索の演算子が使うので触らない。新しく関数を足すときは、同じ revoke を付けること)
revoke all on function public.match_material_chunks(uuid, vector, integer) from public, anon, authenticated;
grant execute on function public.match_material_chunks(uuid, vector, integer) to service_role;

-- これから作るテーブル・関数にも、同じ(権限なし)を既定にする。
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
