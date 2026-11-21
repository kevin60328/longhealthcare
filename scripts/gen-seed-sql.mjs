/* 由 reference/doclist.json 與 seed.json 的機構設定產生 supabase/seed.sql（只含文件清單與機構設定，不含帳號）。
 * 用法：node scripts/gen-seed-sql.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const doclist = JSON.parse(readFileSync('reference/doclist.json', 'utf8'));
const org = JSON.parse(readFileSync('reference/seed.json', 'utf8'))['settings/org'];
const q = v => v == null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const j = v => v == null ? 'null' : `${q(JSON.stringify(v))}::jsonb`;

const rows = doclist.list.map((r, i) =>
  `(${[q(r.key), q(r.cat), q(r.name), q(r.fam), q(r.need), q(r.cond), q(r.stage), q(r.validDays), q(r.medical), q(r.inst), q(r.nurse), q(r.why), q(r.where)].join(', ')}, ${j(r.parts)}, ${i})`);

const sql = `-- 由 scripts/gen-seed-sql.mjs 產生，請勿手動修改。只用於本機／測試專案。
-- 測試帳號與案件由 scripts/seed-test-data.mjs 建立（密碼由執行者用環境變數設定）。

insert into public.org_settings (id, name, phone, hours, request_days, flow_mode, retention_days, rev)
values (1, ${q(org.name)}, ${q(org.phone)}, ${q(org.hours)}, ${q(org.requestDays)}, ${q(org.flowMode)}, ${q(org.retentionDays)}, ${q(org.rev)});

insert into public.doc_catalog (key, cat, name, fam_name, need, cond, stage, valid_days, medical, inst, nurse_decides, why, "where", parts, sort) values
${rows.join(',\n')};
`;
writeFileSync('supabase/seed.sql', sql);
console.log(`seed.sql：${rows.length} 項文件`);
