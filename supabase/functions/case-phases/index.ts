/* Edge Function：case-phases（2026/11/22 使用者決定：案件分配頁的案件階段在伺服器端計算）
 *
 * 為什麼需要：有分配權限的護理師不是承辦人，依權限讀不到算出階段所需的資料（同意書、文件審核、習慣卡、摘要卡依據）。
 * 這個函式用 service role 讀取完整資料，用「同一份」業務規則（_shared/core.js，複製自 js/modules/rules/core.js）算出階段，
 * 只回傳「案件 id → 階段名稱」，分配者看不到任何文件或習慣卡內容。
 *
 * 呼叫：supabase.functions.invoke('case-phases', { body: { case_ids: [...] } })
 * 權限：啟用中的行政，或啟用中且有案件分配權限的護理師；其他人回 403。
 * 只計算「已確認、進行中」的案件（分配頁只列這些）。 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRules } from '../_shared/core.js';
import { assembleModel, todayTW } from '../_shared/model-build.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    /* 確認呼叫者身分與權限（用呼叫者自己的登入 token） */
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: '請先登入' }, 401);
    const { data: me } = await admin.from('profiles').select('role, status, can_assign_nurse').eq('id', u.user.id).single();
    const ok = me && me.status === '啟用' && (me.role === 'staff' || (me.role === 'nurse' && me.can_assign_nurse === true));
    if (!ok) return json({ error: '沒有權限' }, 403);

    const body = await req.json().catch(() => ({}));
    const want = new Set(Array.isArray(body.case_ids) ? body.case_ids.map(String) : []);
    const [models, profiles, org, catalog] = await Promise.all([
      admin.rpc('get_case_models', { p_case: null, p_include_closed: false }),
      admin.from('profiles').select('id, email, name, role, want, status, phone, can_assign_nurse'),
      admin.from('org_settings').select('*').eq('id', 1).maybeSingle(),
      admin.from('doc_catalog').select('key, why, "where", on_demand').order('sort')
    ]);
    for (const r of [models, profiles, org, catalog]) if (r.error) throw r.error;
    const rows = (models.data || []).filter((m: any) => m.case.link_status === '已確認' && (!want.size || want.has(m.case.id)));
    const { D } = assembleModel({ models: rows, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
    const R = createRules(D, { me: null, today: todayTW() });
    const phases: Record<string, string> = {};
    for (const c of Object.values(D.cases) as any[]) phases[c.id] = R.phase(c);
    return json({ phases });
  } catch (e) {
    console.error(e);
    return json({ error: '計算案件階段失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
