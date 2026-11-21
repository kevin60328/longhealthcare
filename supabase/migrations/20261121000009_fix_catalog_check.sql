-- 修正 000007 的 documents_catalog_key 檢查（RLS 測試抓到）：
-- 原本寫成 catalog_key = key or (catalog_key is null and cat = 'G')。catalog_key 為空時，第一段是 null（未知），
-- 第二段在非 G 類是 false，null or false＝null，而 CHECK 條件遇到 null 會「放行」，所以非 G 類文件可以不連到文件清單。
-- 改成明確判斷 is not null。
alter table public.documents drop constraint documents_catalog_key;
alter table public.documents add constraint documents_catalog_key
  check ((catalog_key is not null and catalog_key = key) or (catalog_key is null and cat = 'G'));
