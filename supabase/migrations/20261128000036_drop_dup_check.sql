-- 修正 000035：diagnoses 原本就有規定 diagnoses_source（000007：來源文件與版本同時有或同時沒有），
-- 000035 又加了一條內容完全相同的 diagnoses_source_pair，重複，移除。
-- （000035 刪除 diagnoses 單獨指向文件的外鍵仍然成立：有 diagnoses_source 保證來源文件與版本成對，
--   再由「文件＋版本」「文件＋案件」兩條外鍵保證文件存在、屬於同一案件。）
alter table public.diagnoses drop constraint diagnoses_source_pair;
