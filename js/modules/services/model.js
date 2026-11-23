/* 資料模型：讀 Supabase，交給 model-build.js 轉成業務規則（rules/core.js）使用的格式（與原型的 D 相同）。
 *
 * 讀取來源：
 *   get_case_models()（RPC，資料庫內檢查權限；見 migrations/…000006、000017、000018）
 *   profiles（RLS 範圍內看得到的帳號，給「誰處理的」顯示用）、org_settings、doc_catalog、staff_directory
 * 轉換規則在 model-build.js（瀏覽器與伺服器端 Edge Function 共用）。
 * 只讀不寫。寫入一律走各階段的 RPC。 */
import { supabase } from '../../api/supabase.js';
import { createRules } from '../rules/core.js';
import { buildCase, toAccount, toStamp, todayTW, assembleModel } from './model-build.js';
export { toStamp, todayTW, toAccount };

/* ---------- 載入：回傳 { D, R(規則), me(模型帳號) } ----------
 * 同一頁同一個範圍只讀一次（導覽列徽章與頁面內容共用）；資料寫入後呼叫 invalidateModel() 重新讀取
 * opts.caseId：只讀這一個案件（不論是否結案）
 * opts.includeClosed：也讀結案、封存的案件（預設只讀進行中的案件；見 migrations/…000017）。家屬的案件少，一律全部讀取 */
const cache = new Map();
export function loadModel(meProfile, opts = {}){
  if (meProfile.role === 'family') opts = { ...opts, includeClosed: true };
  const key = (opts.caseId || '*') + (opts.includeClosed ? '+closed' : '');
  if (!cache.has(key)) cache.set(key, fetchModel(meProfile, opts).catch(e => { cache.delete(key); throw e; }));
  return cache.get(key);
}
export const invalidateModel = () => cache.clear();

/* 暫時性錯誤：資料庫查詢逾時（57014 statement timeout）、網路中斷、伺服器 5xx。
 * 階段 10 實測：雲端免費方案在同時有多人操作時，平常 0.1～0.3 秒的查詢偶爾會拖到 8 秒上限被中止，再讀一次通常就正常。
 * 這裡只用在「讀取」（不改資料），重試不會造成重複寫入。權限錯誤等其他錯誤不重試，直接顯示。 */
export function isTransient(e){
  if (!e) return false;
  const msg = String(e.message || e);
  return e.code === '57014' || /statement timeout|Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg) || (e.status >= 500 && e.status < 600);
}

async function fetchModel(meProfile, { caseId = null, includeClosed = false } = {}){
  const db = supabase();
  const read = () => Promise.all([
    db.rpc('get_case_models', { p_case: caseId, p_include_closed: includeClosed }),
    db.from('profiles').select('id, email, name, role, want, status, phone, can_assign_nurse'),
    db.from('org_settings').select('*').eq('id', 1).maybeSingle(),
    db.from('doc_catalog').select('key, why, "where", on_demand').order('sort'),
    db.rpc('staff_directory')
  ]);
  let rs = await read();
  /* 遇到暫時性錯誤：等 1 秒自動再讀一次（只一次），還是失敗才顯示「無法載入資料」 */
  if (rs.some(r => isTransient(r.error))){ await new Promise(ok => setTimeout(ok, 1000)); rs = await read(); }
  const [models, profiles, org, catalog, staff] = rs;
  for (const r of rs) if (r.error) throw r.error;
  const { D, me } = assembleModel({ models: models.data, profiles: profiles.data, org: org.data, catalog: catalog.data, staff: staff.data }, meProfile);
  return { D, me, R: createRules(D, { me, today: todayTW() }) };
}

/* 測試用：直接用 RPC 回傳的資料建模型（tests/rls/model.test.js） */
export const _buildCase = buildCase;
