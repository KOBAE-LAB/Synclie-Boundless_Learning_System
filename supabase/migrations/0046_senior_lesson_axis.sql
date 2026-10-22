-- 先輩型の「当時モード」の時間の絞り込みを、教科・科目学習モードでは「授業回の番号」で行う(2026-10-23、先生の決定)。
--   探究学習モードは、これまでどおり「探究の段階」で絞る。教科・科目学習モードは段階を使わないので、
--   エピソードがもとの授業回の番号(inquiry_episodes.lesson_no)を持っていることを使い、「後輩のいまの回まで」の場面だけを引く。
--   検索関数に p_max_lesson_no を足す(null なら絞らない)。戻り値に lesson_no も足す。
--   関数の引数が変わるので、古い関数を消して作り直す(0045の関数と二重に残さない)。呼び出し側は、先にこのマイグレーションを入れてから出す。

drop function if exists public.match_inquiry_episodes(uuid, text[], text, vector, integer);

create or replace function match_inquiry_episodes(
  p_project_id uuid,
  p_stage_keys text[],
  p_kind text,
  p_query_embedding vector(1536),
  p_match_count int default 1,
  p_max_lesson_no int default null
)
returns table (episode_id uuid, version_id uuid, stage_key text, seq int, context_header text, body text, similarity float, lesson_no int)
language sql
stable
as $$
  select e.id, v.id, e.stage_key, e.seq, v.context_header, v.body,
         1 - (v.embedding <=> p_query_embedding) as similarity,
         e.lesson_no
  from inquiry_episodes e
  join lateral (
    select * from inquiry_episode_versions v
    where v.episode_id = e.id and v.kind = p_kind and v.embedding is not null
    order by v.version desc
    limit 1
  ) v on true
  where e.project_id = p_project_id
    and (p_stage_keys is null or e.stage_key = any (p_stage_keys))
    -- 授業回の番号が分からない場面は、「その回まで」とは言えないので、絞るときは使わない(結論を先取りしないため)。
    and (p_max_lesson_no is null or (e.lesson_no is not null and e.lesson_no <= p_max_lesson_no))
  order by v.embedding <=> p_query_embedding
  limit p_match_count;
$$;
revoke all on function public.match_inquiry_episodes(uuid, text[], text, vector, integer, integer) from public, anon, authenticated;
grant execute on function public.match_inquiry_episodes(uuid, text[], text, vector, integer, integer) to service_role;
