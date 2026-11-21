-- 跨案件的關聯一致性（2026/11/21 正規化檢查時發現）
-- 外鍵只保證「指向的資料存在」，不保證「屬於同一個案件」。以下三處要求必須是同一案件：
--   1. 個資同意的代理權證明文件（consents.proof_document_id）
--   2. 診斷的來源文件（diagnoses.source_document）：診斷已經記了 case_id，來源文件若屬於別的案件就是矛盾資料
--   3. 文件版本「沿用其他文件的檔案」（document_versions.from_document_id）
-- 做法：documents 加 (id, case_id) 唯一鍵，前兩處改成「文件＋案件」的複合外鍵，由資料庫直接保證；
--       第 3 處的版本表沒有 case_id（由文件推得，不重複存），用觸發器檢查。

alter table public.documents add constraint documents_id_case unique (id, case_id);

alter table public.consents drop constraint consents_proof_fk;
alter table public.consents add constraint consents_proof_same_case
  foreign key (proof_document_id, case_id) references public.documents(id, case_id);

alter table public.diagnoses add constraint diagnoses_source_same_case
  foreign key (source_document, case_id) references public.documents(id, case_id);

create or replace function public.version_from_same_case() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.from_document_id is not null and
     (select case_id from public.documents where id = new.from_document_id) is distinct from
     (select case_id from public.documents where id = new.document_id) then
    raise exception '只能沿用同一案件的文件檔案' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger version_from_same_case before insert or update of from_document_id, document_id on public.document_versions
  for each row execute function public.version_from_same_case();
revoke execute on function public.version_from_same_case() from public, anon, authenticated;
