-- 修正 000014 的 coordinate：PL/pgSQL 裡 by 是保留字，記錄欄位要寫成 a."by"（RPC 測試抓到「協調完成，可以收治」會失敗）。

create or replace function public.coordinate(p_case uuid, p_result text, p_note text, p_date date, p_close_type text, p_expired uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cases := public.staff_case_for_update(p_case); a public.assessments := public.current_assessment(p_case);
  n text := btrim(coalesce(p_note, '')); not_adm boolean; pass text; phone text; ref boolean;
begin
  if c.closed_at is not null or public.consent_state(c.id) <> '有效' or a.id is null or a.result not in ('待協調','不符合收治條件') then
    raise exception '案件目前不是待協調狀態' using errcode = 'P0001'; end if;
  not_adm := a.result = '不符合收治條件';
  pass := case c.flow_mode when '先審後簽' then '收治' else '可入住' end;
  if n = '' then raise exception '%', case when p_result = '取消' then '請填寫結果說明' when p_result = '延期' then '請填寫原因' else '請填寫協調內容' end using errcode = '22023'; end if;
  if p_result = '可入住' then
    if not_adm then raise exception '「不符合收治條件」需交回護理重新評估，行政不能直接改為可入住' using errcode = 'P0001'; end if;
    /* 新增一筆通過的評估（沿用原評估內容與評估人），原評估留在歷程 */
    insert into public.assessments (case_id, mode, result, move, behav, iso, reason, coord_from, coord_note, coord_by, coord_at, by, at)
      values (c.id, a.mode, pass, a.move, a.behav, a.iso, a.reason, '待協調', n, auth.uid(), now(), a."by", now());
    perform public.log_action(c.id, '協調完成，' || pass || '：' || n);
    perform public.notify_family(c.id, case when pass = '收治' then '好消息：協調完成，住民已通過評估，請來電預約參訪與簽約' else '入住安排已協調完成，照顧團隊正在準備' end);
  elsif p_result = '重評' then
    update public.assessments set outcome = '重新評估', coord_note = n, coord_by = auth.uid(), coord_at = now() where id = a.id;
    perform public.log_action(c.id, '協調結果：交回護理重新評估（' || n || '）');
  elsif p_result = '延期' then
    if p_date is null or p_date < public.today_tw() then raise exception '請選擇新的日期' using errcode = '22023'; end if;
    update public.cases set planned_admit = p_date, updated_at = now() where id = c.id;
    update public.assessments set outcome = '延期', coord_note = '延期：' || n, coord_by = auth.uid(), coord_at = now() where id = a.id;
    perform public.log_action(c.id, '協調結果：延後入住至 ' || to_char(p_date, 'YYYY/MM/DD') || '（' || n || '）');
    perform public.notify_family(c.id, '入住日已調整為 ' || to_char(p_date, 'YYYY/MM/DD') || '，請留意系統通知');
    perform public.notify_expired(c.id, p_expired, p_date);
  elsif p_result = '取消' then
    if p_close_type is null or p_close_type not in ('不符合收治條件，解除契約','轉介其他機構','取消入住') then raise exception '請選擇結果' using errcode = '22023'; end if;
    ref := p_close_type = '轉介其他機構';
    select org.phone into phone from public.org_settings org where id = 1;
    update public.cases set closed_at = now(), closed_by = auth.uid(),
      closed_title = case when ref then '已協助轉介其他機構' when not_adm then '經評估，本中心無法提供合適的照顧' else '入住申請已結案' end,
      closed_text = n || case when ref then '' else '　如有疑問請來電：' || coalesce(phone, '') end,
      closed_reason = p_close_type || '：' || n, closed_type = case when ref then '轉介' when not_adm then '不符合收治條件' else '取消' end, updated_at = now() where id = c.id;
    perform public.notify_family(c.id, '機構已通知您入住評估結果，請登入查看');
    perform public.log_action(c.id, '協調結果：' || p_close_type || '（' || n || '），已通知家屬並結案');
  else
    raise exception '協調結果不正確' using errcode = '22023';
  end if;
end $$;
