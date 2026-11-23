/* Edge Function：admin-testdata（HANDOFF 10.10：測試資料功能只在測試環境；原型 adminTestData、test-seed、test-seed-missing）
 *
 * 建立或恢復固定編號的虛構測試案件 T-A～T-D（原型 v18 的 4 筆測試案件），方便直接從各畫面開始人工審核。
 * 建立邏輯與 npm run db:seed-cases 相同（_shared/test-cases-core.js，副本由 functions:sync 從 scripts/test-cases-core.mjs 複製）。
 * 只在測試環境：資料庫 system_env.is_test 為「否」時一律拒絕（正式專案不會出現這個功能）。不建立帳號、不寫入密碼。
 *
 * 呼叫：supabase.functions.invoke('admin-testdata', { body })
 *   { action: 'status' }                  目前 4 筆測試案件是否存在與案件階段
 *   { action: 'seed', nos: ['T-A'] }      恢復起始狀態（刪除後重建；這筆案件上的人工操作都會清除）
 *   { action: 'missing' }                 只建立尚未存在的測試案件
 * 權限：啟用中的系統管理員。 */
import { adminClient, caller, json, CORS } from '../_shared/server.ts';
import { seedTestCases } from '../_shared/test-cases-core.js';
import { assembleModel, todayTW } from '../_shared/model-build.js';
import { createRules } from '../_shared/core.js';
import bases from '../_shared/test-cases.json' with { type: 'json' };

const NOS = (bases as any[]).map(b => b.c.no);

/* 刪除舊案件上傳過的檔案（測試人員在 T-A～T-D 上傳的） */
async function removeFiles(admin: any, ids: string[]){
  const bucket = admin.storage.from('case-files');
  for (const id of ids){
    const { data: dirs } = await bucket.list(id, { limit: 1000 });
    for (const d of dirs || []){ const { data: files } = await bucket.list(`${id}/${d.name}`, { limit: 1000 }); const paths = (files || []).filter((f: any) => f.id).map((f: any) => `${id}/${d.name}/${f.name}`); if (paths.length) await bucket.remove(paths); }
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    if (me.role !== 'admin') return json({ error: '只有系統管理員可以建立測試資料' }, 403);
    const { data: isTest } = await admin.rpc('is_test_env');
    if (isTest !== true) return json({ error: '測試資料功能只在測試環境' }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'status'){
      const [models, profiles, org, catalog] = await Promise.all([
        admin.rpc('get_case_models', { p_case: null, p_include_closed: true }), admin.from('profiles').select('id, email, name, role, want, status, phone, can_assign_nurse'),
        admin.from('org_settings').select('*').eq('id', 1).maybeSingle(), admin.from('doc_catalog').select('key, why, "where", on_demand').order('sort')]);
      for (const r of [models, profiles, org, catalog]) if (r.error) throw r.error;
      const rows = (models.data || []).filter((m: any) => NOS.includes(m.case.no));
      const { D } = assembleModel({ models: rows, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
      const R = createRules(D, { me: null, today: todayTW() });
      const byNo = Object.fromEntries(Object.values(D.cases).map((c: any) => [c.no, c]));
      const nameOf = (e: string) => ((profiles.data || []).find((p: any) => p.email === e) || {}).name || e;
      return json({ specs: (bases as any[]).map(b => { const c = byNo[b.c.no]; const t = b.c.test || {};
        return { no: b.c.no, label: t.label || b.c.no, use: t.use || '', start: t.start || '', name: b.c.patient.name, flow: b.c.flowMode,
          family: nameOf(b.c.familyId), relation: b.c.relation, nurse: nameOf(b.c.nurseId), caregivers: ((b.c.card || {}).caregivers || []).map(nameOf),
          exists: !!c, phase: c ? R.phase(c) : null }; }) });
    }
    let only: string[] = [];
    if (body.action === 'seed') only = (Array.isArray(body.nos) ? body.nos : []).filter((n: string) => NOS.includes(n));
    else if (body.action === 'missing'){
      const { data: have } = await admin.from('cases').select('no').in('no', NOS);
      only = NOS.filter(n => !(have || []).some((h: any) => h.no === n));
      if (!only.length) return json({ ok: true, done: [], note: '測試案件都已存在。要回到起始狀態，請按各案件的「恢復起始狀態」。' });
    } else return json({ error: '不支援的操作' }, 400);
    if (!only.length) return json({ error: '沒有要處理的測試案件' }, 400);
    const { done, removed } = await seedTestCases(admin, bases as any[], only);
    await removeFiles(admin, removed);
    const actor = me.name || '';
    for (const x of done){
      const { data: c } = await admin.from('cases').select('id').eq('no', x.no).single();
      await admin.from('audit_logs').insert({ case_id: c.id, actor: me.id, actor_name: actor, role: 'admin', action: `${removed.length ? '恢復' : '建立'}測試資料：${x.no}（僅供測試）`, family_visible: false });
    }
    return json({ ok: true, done });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: '測試資料處理失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
