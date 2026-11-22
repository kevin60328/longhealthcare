-- 修正 documents_catalog_key 約束：catalog_key 為空值時 (catalog_key = key) 的結果是 null，
-- CHECK 約束遇到 null 視為通過，導致「不在文件清單、key 也不是 custom_／extra_」的文件可以存入。
-- 改用 coalesce 明確把 null 當成 false。（tests/rls/basic.test.js 驗證）
-- 先確認沒有既有資料違反新規則，否則中止（不自動改資料）。
do $$ begin
  if exists (select 1 from public.documents where catalog_key is null and key !~ '^(custom|extra)_[a-z0-9]+$') then
    raise exception '有不在文件清單、key 格式不符的文件，請先人工處理：%',
      (select string_agg(case_id || '/' || key, ', ') from public.documents where catalog_key is null and key !~ '^(custom|extra)_[a-z0-9]+$');
  end if;
end $$;
alter table public.documents drop constraint documents_catalog_key;
alter table public.documents add constraint documents_catalog_key check (
  coalesce(catalog_key = key and custom_why is null and custom_where is null, false)
  or (catalog_key is null and key ~ '^(custom|extra)_[a-z0-9]+$'));
