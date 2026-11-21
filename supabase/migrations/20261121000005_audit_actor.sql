-- 操作紀錄要比帳號活得久：拿掉 audit_logs.actor 對 profiles 的外鍵。
-- 原因：紀錄只能新增不能修改（不能 on delete set null），有外鍵時任何寫過紀錄的帳號都刪不掉。
-- 紀錄裡另外存了 actor_name（當時的姓名），帳號刪除後仍看得出是誰做的。
alter table public.audit_logs drop constraint if exists audit_logs_actor_fkey;
