/* Edge Functions 共用的伺服器端小工具（手寫檔，不是由 functions:sync 複製的）：
 *   CORS、JSON 回應、確認呼叫者身分、用 service role 讀一個案件的完整資料並套上業務規則（與畫面同一份 core.js）。 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRules } from './core.js';
import { assembleModel, todayTW } from './model-build.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* service role 連線（只在伺服器端；金鑰由 Supabase 自動提供給 Edge Function，不在前端） */
export const adminClient = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/* 呼叫者：用呼叫者自己的登入 token 確認身分，回傳 profiles 列（啟用中才算）；沒有登入或未啟用回傳 null */
export async function caller(admin: any, req: Request){
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!jwt) return null;
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user) return null;
  const { data: me } = await admin.from('profiles').select('id, name, role, status, can_assign_nurse').eq('id', u.user.id).single();
  return me && me.status === '啟用' ? me : null;
}

/* 讀一個案件（service role，不受個人權限限制）並建立規則物件；每次都重新讀，不用快取（寄送前要確認最新狀態） */
export async function loadCase(admin: any, caseId: string){
  const [models, profiles, org, catalog] = await Promise.all([
    admin.rpc('get_case_models', { p_case: caseId, p_include_closed: true }),
    admin.from('profiles').select('id, email, name, role, want, status, phone, can_assign_nurse, notify_email'),
    admin.from('org_settings').select('*').eq('id', 1).maybeSingle(),
    admin.from('doc_catalog').select('key, why, "where", on_demand').order('sort')
  ]);
  for (const r of [models, profiles, org, catalog]) if (r.error) throw r.error;
  const { D } = assembleModel({ models: models.data || [], profiles: profiles.data, org: org.data, catalog: catalog.data, staff: [] }, null);
  const R = createRules(D, { me: null, today: todayTW() });
  return { D, R, c: (D as any).cases[caseId] || null };
}
