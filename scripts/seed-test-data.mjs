/* 建立測試帳號與測試案件（HANDOFF 第 12 節；資料來自 reference/seed.json）。只用於本機或測試專案。
 *
 * 用法：npm run db:seed
 * 連線資料與 SEED_PASSWORD 從 .env、.env.secrets 讀取（見 scripts/load-env.mjs）；密碼不寫進程式或版本控制。
 * 遠端專案必須在 .env.secrets 標示 SEED_ALLOW_REMOTE=1 才會寫入，避免誤寫正式專案。
 * 可重複執行：已存在的帳號與案件會略過。 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, assertTestTarget } from './load-env.mjs';

const env = loadEnv();
const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY, password = env.SEED_PASSWORD;

if (!url || !key) throw new Error('找不到 Supabase URL 或 service role key（.env 的 VITE_SUPABASE_URL、.env.secrets 的 SUPABASE_SERVICE_ROLE_KEY）');
if (!password || password.length < 8) throw new Error('請在 .env.secrets 設定 SEED_PASSWORD（至少 8 個字元）');
assertTestTarget(env);

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const seed = JSON.parse(readFileSync('reference/seed.json', 'utf8'));
const tw = s => s ? s.replace(/\//g, '-').replace(' ', 'T') + ':00+08:00' : null;   // 原型時間為台灣時間 YYYY/MM/DD HH:MM

const must = (res, what) => { if (res.error) throw new Error(`${what}：${res.error.message}`); return res.data; };

/* ---------- 帳號 ---------- */
const CAN_ASSIGN = new Set(['nurse@example.com']);   // 黃護理師（可分配）
const existing = must(await db.auth.admin.listUsers({ perPage: 1000 }), '讀取帳號').users;
const ids = Object.fromEntries(existing.map(u => [u.email, u.id]));

for (const [k, a] of Object.entries(seed)){
  if (!k.startsWith('accounts/')) continue;
  const active = a.status === '啟用';
  if (!ids[a.email]){
    const user = must(await db.auth.admin.createUser({
      email: a.email, password, email_confirm: true,
      user_metadata: { name: a.name, phone: a.phone, want: a.want }
    }), `建立帳號 ${a.email}`).user;
    ids[a.email] = user.id;
  }
  /* 角色一律直接寫進 profiles（service role）。
   * 不靠 app_metadata：Admin API 建立帳號時先新增使用者、之後才寫 app_metadata，
   * profiles 觸發器執行時讀不到角色，員工帳號會變成待審核。
   * 每次執行都會寫一次，所以也能修正先前建立錯誤的帳號。待審核的員工維持觸發器的結果（role 為空）。 */
  if (active){
    must(await db.from('profiles').update({
      role: a.role, want: a.want || a.role, status: '啟用', name: a.name, phone: a.phone,
      can_assign_nurse: CAN_ASSIGN.has(a.email)
    }).eq('id', ids[a.email]), `設定 ${a.email} 角色`);
  }
  console.log(`帳號 ${a.email}（${a.name}，${active ? a.role : '待審核'}）`);
}

/* ---------- 案件與文件 ---------- */
/* 每案都有的文件（不含只在需要時加入的代理權證明） */
const catalog = must(await db.from('doc_catalog').select('*').eq('on_demand', false).order('sort'), '讀取文件清單');
const parts = must(await db.from('doc_catalog_parts').select('*'), '讀取文件核對項目');

for (const [k, c] of Object.entries(seed)){
  if (!k.startsWith('cases/')) continue;
  const caseKey = k.slice(6);
  const found = must(await db.from('cases').select('id').eq('no', c.no).maybeSingle(), `查詢 ${c.no}`);
  if (found){ console.log(`案件 ${c.no} 已存在，略過`); continue; }

  /* 住民（以身分證字號區分同一個人；已存在就沿用） */
  const resident = must(await db.from('residents').upsert({ nid: c.patient.nid, name: c.patient.name, birth: c.patient.birth || null, chart_no: c.patient.chart || '' },
    { onConflict: 'nid' }).select('id').single(), `建立住民 ${c.patient.name}`);
  /* 承辦護理師不能在建立案件時直接指定，要新增分配紀錄（資料庫觸發器會同步 cases.nurse_id） */
  const row = must(await db.from('cases').insert({
    no: c.no, family_id: ids[c.familyId], relation: c.relation, resident_id: resident.id,
    flow_mode: c.flowMode, hospital: c.hospital, planned_admit: c.plannedAdmit || null,
    link_status: c.linkStatus, created_at: tw(c.createdAt), updated_at: tw(c.createdAt)
  }).select('id').single(), `建立案件 ${c.no}`);
  if (c.nurseId) must(await db.from('case_assignments').insert({ case_id: row.id, nurse_id: ids[c.nurseId], by: null, at: null, reason: '舊資料：分配時間未記錄' }), `${c.no} 承辦護理師`);

  const items = Object.entries(seed).filter(([ik, it]) => ik.startsWith('items/') && it.caseId === caseKey).map(([, it]) => it);
  const docs = catalog.map(r => {
    const it = items.find(x => x.key === r.key) || {};
    return { case_id: row.id, key: r.key, catalog_key: r.key, cat: r.cat, name: r.name, fam_name: r.fam_name, stage: r.stage, need: r.need, cond: r.cond,
      valid_days: r.valid_days, medical: r.medical, inst: r.inst, nurse_decides: r.nurse_decides, sort: r.sort,
      cond_met: it.condMet ?? null, created_at: tw(c.createdAt) };
  });
  const made = must(await db.from('documents').insert(docs).select('id, key'), `建立 ${c.no} 文件`);
  /* 文件的核對項目：複製建立當時的清單設定（歷史快照） */
  const partRows = made.flatMap(d => parts.filter(p => p.catalog_key === d.key).map(p => ({ document_id: d.id, k: p.k, name: p.name, need: p.need, sort: p.sort })));
  if (partRows.length) must(await db.from('document_parts').insert(partRows), `建立 ${c.no} 核對項目`);

  const famName = seed['accounts/' + c.familyId].name;
  const logs = Object.values(seed).filter(l => l.caseId === caseKey && l.what).map(l => ({
    case_id: row.id, actor: ids[c.familyId], actor_name: famName, role: 'family',
    action: l.what, family_visible: true, at: tw(l.at) }));
  must(await db.from('audit_logs').insert(logs), `建立 ${c.no} 紀錄`);
  console.log(`案件 ${c.no}（${c.patient.name}，${c.flowMode}）：${docs.length} 份文件`);
}
/* 這是測試專案：開啟「測試資料」功能（settings.html?view=testdata）。正式專案不執行這個腳本，維持 migration 寫入的「否」（HANDOFF 10.10） */
must(await db.from('system_env').update({ is_test: true }).eq('id', 1), '標示測試環境');
console.log('已標示為測試環境（測試資料功能可用）');
console.log('完成');
