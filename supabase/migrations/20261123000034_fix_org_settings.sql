-- 修正 update_org_settings：停用合作醫院的 UPDATE 沒有 where 條件，透過 API 呼叫時被 Supabase 的 safeupdate 保護拒絕。
-- 加上 where active，其餘與 000033 相同。

create or replace function public.update_org_settings(p_rev int, p_name text, p_phone text, p_hours text, p_request_days int, p_retention_days int,
  p_flow_mode text, p_partners text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.org_settings; n int := 0; h text;
begin
  perform public.admin_guard();
  select * into o from public.org_settings where id = 1 for update;
  if o.rev <> p_rev then raise exception '其他管理員剛更新過設定，請重新開啟後再修改' using errcode = 'P0001'; end if;
  if p_flow_mode not in ('先審後簽','先簽後審') then raise exception '請選擇入住流程順序' using errcode = '22023'; end if;
  if coalesce(p_request_days, 0) not between 1 and 60 then raise exception '補件期限請填 1～60 天' using errcode = '22023'; end if;
  if coalesce(p_retention_days, 0) < 30 then raise exception '結案資料保存天數至少 30 天' using errcode = '22023'; end if;
  update public.org_settings set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), o.name), phone = btrim(coalesce(p_phone, '')), hours = btrim(coalesce(p_hours, '')),
    request_days = p_request_days, retention_days = p_retention_days, flow_mode = p_flow_mode, rev = o.rev + 1, updated_at = now(), updated_by = auth.uid() where id = 1;
  /* 合作醫院：清單上的依順序啟用（新的就新增），不在清單上的停用（保留紀錄，舊案件的醫院名稱不受影響） */
  update public.partner_hospitals set active = false where active;   -- 一定要有 where：Supabase 的 safeupdate 會拒絕沒有條件的 UPDATE
  foreach h in array coalesce(p_partners, '{}') loop
    h := btrim(h);
    if h <> '' then
      insert into public.partner_hospitals (name, sort, active) values (h, n, true) on conflict (name) do update set sort = excluded.sort, active = true;
      n := n + 1;
    end if;
  end loop;
  perform public.log_action(null, '機構設定已更新' || case when o.flow_mode <> p_flow_mode then '（入住流程：' || o.flow_mode || ' → ' || p_flow_mode || '，只影響之後新建的申請）' else '' end, false);
  return o.rev + 1;
end $$;

