/* 由 reference/doclist.json 與 seed.json 的機構設定產生 supabase/seed.sql（只含文件清單、核對項目與機構設定，不含帳號）。
 * 可重複套用：已存在的資料不重複新增（on conflict do nothing）。
 * 用法：node scripts/gen-seed-sql.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const doclist = JSON.parse(readFileSync('reference/doclist.json', 'utf8'));
const org = JSON.parse(readFileSync('reference/seed.json', 'utf8'))['settings/org'];
const q = v => v == null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

const rows = doclist.list.map((r, i) =>
  `(${[q(r.key), q(r.cat), q(r.name), q(r.fam), q(r.need), q(r.cond), q(r.stage), q(r.validDays), q(r.medical), q(r.inst), q(r.nurse), q(r.why), q(r.where)].join(', ')}, ${i})`);
/* 核對項目（例如體檢報告的 CBC、肝功能）：每項一列（正規化，見 migrations/…000007） */
const parts = doclist.list.flatMap(r => (r.parts || []).map((p, n) => `(${[q(r.key), q(p.k), q(p.name), q(p.need), n].join(', ')})`));

const sql = `-- 由 scripts/gen-seed-sql.mjs 產生，請勿手動修改。只用於本機／測試專案。
-- 測試帳號與案件由 scripts/seed-test-data.mjs 建立（密碼由執行者用環境變數設定）。

insert into public.org_settings (id, name, phone, hours, request_days, flow_mode, retention_days, rev)
values (1, ${q(org.name)}, ${q(org.phone)}, ${q(org.hours)}, ${q(org.requestDays)}, ${q(org.flowMode)}, ${q(org.retentionDays)}, ${q(org.rev)})
on conflict (id) do nothing;

insert into public.doc_catalog (key, cat, name, fam_name, need, cond, stage, valid_days, medical, inst, nurse_decides, why, "where", sort) values
${rows.join(',\n')}
on conflict (key) do nothing;

insert into public.doc_catalog_parts (catalog_key, k, name, need, sort) values
${parts.join(',\n')}
on conflict (catalog_key, k) do nothing;
`;
writeFileSync('supabase/seed.sql', sql);
console.log(`seed.sql：${rows.length} 項文件`);
