/* 登入狀態（HANDOFF 6.4）：取得 session、讀自己的 profiles、頁面守門、登入、登出、註冊、忘記密碼、改密碼。
 * 帳號密碼由 Supabase Auth 管理，系統不自己存密碼。 */
import { supabase } from './api/supabase.js';
import { canEnter, homeOf } from './permissions.js';

/* 我們的 8 個頁面；登入後要回去的 next 只接受這些頁面，避免被導到外部網站 */
const PAGES = ['login', 'dashboard', 'application', 'cases', 'documents', 'assessment', 'care-summary', 'settings'];

/* next 參數 → 安全的相對網址；不合格回傳 null */
export function safeNext(next){
  if (!next) return null;
  try {
    const u = new URL(next, location.href);
    if (u.origin !== location.origin) return null;
    const file = u.pathname.split('/').pop().replace(/\.html$/, '');
    if (!PAGES.includes(file) || file === 'login') return null;
    return `${file}.html${u.search}`;
  } catch { return null; }
}

/* 目前網址（給 login.html?next= 用） */
export const hereForNext = () => location.pathname.split('/').pop() + location.search;

export const loginUrl = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return 'login.html' + (q.toString() ? '?' + q : '');
};

export async function getSession(){
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

/* 讀自己的 profiles；RLS 保證只讀得到自己（或依角色允許的範圍），這裡用 id 指定自己 */
export async function loadProfile(userId){
  const { data, error } = await supabase().from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/* 頁面守門：未登入導回登入頁；帳號未啟用導到審核中畫面；臨時密碼導到改密碼；沒有權限回傳 denied。
 * 回傳 { me, denied } 或 null（已經導頁，呼叫端不用再畫）。 */
export async function guardPage(page, view){
  const session = await getSession();
  if (!session){ location.replace(loginUrl({ next: hereForNext() })); return null; }
  const me = await loadProfile(session.user.id);
  if (!me){ await supabase().auth.signOut({ scope: 'local' }); location.replace(loginUrl({ msg: 'noprofile' })); return null; }
  if (me.status !== '啟用'){ location.replace(loginUrl({ view: 'pending' })); return null; }
  if (me.must_change_password){ location.replace(loginUrl({ view: 'password' })); return null; }
  return { me, denied: !canEnter(me, page, view) };
}

/* 已登入的使用者登入後要去哪裡 */
export function afterLoginUrl(me, next){
  if (me.status !== '啟用') return loginUrl({ view: 'pending' });
  if (me.must_change_password) return loginUrl({ view: 'password' });
  return safeNext(next) || homeOf(me);
}

/* 登出：只登出這個瀏覽器（scope: 'local'）。Supabase 預設會登出這個帳號在所有裝置的登入，不符合原型行為。
 * 用 replace 離開，瀏覽器「上一頁」不會回到受保護的頁面。
 * 自己按登出時回到入口選擇（不帶 next）；leaving 讓下面的 SIGNED_OUT 監聽不要再導一次。 */
let leaving = false;
export async function logout(){
  leaving = true;
  try { await supabase().auth.signOut({ scope: 'local' }); }
  finally { location.replace('login.html'); }
}

/* 受保護頁面的持續檢查：
 * 1. 其他分頁登出（或 session 失效）時，這一頁也回到登入頁
 * 2. 從瀏覽器快取（上一頁）回來時重新確認 session，登出後不能看到舊畫面 */
export function watchSession(){
  supabase().auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && !leaving) location.replace(loginUrl({ next: hereForNext() }));
  });
  window.addEventListener('pageshow', async e => {
    if (!e.persisted) return;
    document.body.hidden = true;     // 先藏起舊畫面，確認後再顯示
    const s = await getSession().catch(() => null);
    if (!s) location.replace(loginUrl({ next: hereForNext() })); else document.body.hidden = false;
  });
}
