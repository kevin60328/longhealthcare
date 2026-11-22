-- 補件 Email：判斷「這個補件事件是否仍開啟」改由資料庫一次查出（send-mail 寄送前、送出前各確認一次）。
-- 原本 send-mail 每次確認都讀整個案件再用 rules/core.js 的 mailReqEvent 判斷，補件一多就慢（E2E 等待逾時）。
-- 判斷與 mailReqEvent 相同（HANDOFF 10.3、10.4）：
--   gone      文件已刪除或找不到
--   replaced  已被同一份文件的下一次補件取代
--   closed    已有關閉紀錄，或文件已確認符合（doc_done，與 rules/core.js 的 isDone 逐筆比對一致，見 tests/rls/documents.test.js）
--   missing   文件已確認符合，但補件的關閉紀錄沒有寫入（資料待修復；不寄送）
--   open      其他
create or replace function public.req_event(p_request uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when q.id is null or d.id is null or d.deleted_at is not null then 'gone'
    when q.superseded_by is not null then 'replaced'
    when q.closed_at is not null then 'closed'
    when public.doc_done(d.id) then 'missing'
    else 'open' end
  from (select 1) x
  left join public.document_requests q on q.id = p_request
  left join public.documents d on d.id = q.document_id
$$;
revoke execute on function public.req_event(uuid) from public, anon, authenticated;
grant execute on function public.req_event(uuid) to service_role;
