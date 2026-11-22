-- 修正 open_document_file：變數名稱 v 與 document_versions.v 欄位同名，查詢時欄位不明確（42702）。改名為 ver，其餘不變。

create or replace function public.open_document_file(p_doc uuid, p_v int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.documents; c public.cases; ver public.document_versions; n int;
begin
  if not public.can_read_document(p_doc) then raise exception '沒有權限查看這份文件' using errcode = '42501'; end if;
  select * into d from public.documents where id = p_doc;
  select * into c from public.cases where id = d.case_id;
  if public.consent_state(c.id) = '已撤回' then raise exception '家屬已撤回資料授權，不能再開啟文件' using errcode = 'P0001'; end if;
  select x.* into ver from public.document_versions x where x.document_id = d.id and x.v = p_v;
  if not found then raise exception '找不到這個版本' using errcode = 'P0002'; end if;
  if ver.storage_path is null or ver.file_removed then return jsonb_build_object('path', null, 'removed', ver.file_removed); end if;
  if public.auth_role() = 'staff' and (d.cat in ('B','C','D') or d.medical) then
    insert into public.document_views (document_id, version_v, viewer) values (d.id, ver.v, auth.uid()) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then perform public.log_action(c.id, '行政查看醫療文件：' || d.name || '（第 ' || ver.v || ' 版，僅查看）', false); end if;
  end if;
  return jsonb_build_object('path', ver.storage_path, 'name', ver.file_name, 'mime', ver.mime, 'removed', false);
end $$;

