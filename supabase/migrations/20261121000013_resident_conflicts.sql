-- 階段 4：行政處理「同一身分證字號、住民資料不同」的申請（使用者決定的流程）
-- 行政在工作清單看到待處理的紀錄，電話聯絡申請人確認後，填寫處理說明並標示已處理。
-- 住民資料若需要更正，由行政在案件頁處理（階段 5）；這裡只記錄處理結果，不改住民資料。

create or replace function public.resolve_resident_conflict(p_id bigint, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.resident_conflicts; note text := btrim(coalesce(p_resolution, ''));
begin
  if public.auth_role() is distinct from 'staff' then raise exception '只有行政可以處理' using errcode = '42501'; end if;
  if note = '' then raise exception '請填寫處理說明（例如已電話確認的結果）' using errcode = '22023'; end if;
  select * into r from public.resident_conflicts where id = p_id for update;
  if not found then raise exception '找不到這筆紀錄' using errcode = 'P0002'; end if;
  if r.resolved_at is not null then raise exception '這筆紀錄已經處理過了' using errcode = 'P0001'; end if;
  update public.resident_conflicts set resolved_at = now(), resolved_by = auth.uid(), resolution = note where id = p_id;
  perform public.log_action(null, '處理住民資料不一致的申請（' || r.submitted_name || '）：' || note, false);
end $$;

revoke execute on function public.resolve_resident_conflict(bigint, text) from public, anon;
grant execute on function public.resolve_resident_conflict(bigint, text) to authenticated;
