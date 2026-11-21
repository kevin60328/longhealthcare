/* 受保護頁面（login.html 以外的 7 頁）共用的開頭流程（HANDOFF 6.4）：
 *   1. 取得 session，沒登入導回 login.html?next=目前網址
 *   2. 讀自己的 profiles；帳號未啟用導到審核中畫面，臨時密碼導到改密碼
 *   3. 檢查這個角色能不能進這一頁／view（畫面判斷，真正的保護在 RLS）
 *   4. 畫出頁首導覽列與徽章
 *   5. 交給各頁模組畫內容
 * 用法：bootPage('cases', async ({ main, me, view, params, shell }) => { main.innerHTML = … });
 *
 * 另外處理：帳號缺手機號碼時顯示補填提示（不擋住使用）；連線失敗時顯示錯誤與重試。 */
import { guardPage, logout, watchSession } from './auth.js';
import { mountShell } from './navigation.js';
import { homeOf } from './permissions.js';
import { getOrg } from './modules/services/org.js';
import { badgeCounts } from './modules/services/badges.js';
import { supabase } from './api/supabase.js';
import { esc, toast, fieldErr, onSubmit, decorateRequired, errText, showFlash } from './ui.js';
import { phoneValid, phoneMsg } from './modules/rules/account.js';

export async function bootPage(page, render){
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || '';
  const main = document.getElementById('main');

  let g;
  try { g = await guardPage(page, view); }
  catch (e){ return showLoadError(main, e); }
  if (!g) return;                       // 已經導到登入、審核中或改密碼畫面
  const { me, denied } = g;

  const org = await getOrg();
  const shell = mountShell({ orgName: org?.name, me, page, view, from: params.get('from') || '', onLogout: logout });
  watchSession();
  showFlash();
  badgeCounts(me).then(b => shell.setBadges(b)).catch(() => { /* 徽章失敗不影響頁面 */ });

  if (denied){
    main.innerHTML = `<div class="auth card stack"><h1>沒有權限</h1><p>您的帳號（${esc(me.name)}）不能使用這個畫面。</p><a class="btn primary" href="${homeOf(me)}">回到首頁</a></div>`;
    return;
  }

  main.innerHTML = '';
  const content = document.createElement('div');
  main.append(content);
  if (!phoneValid(me.phone)) main.prepend(phoneBanner(me));
  try {
    await render({ main: content, me, view, params, shell, org });
    decorateRequired(content);
  } catch (e){ showLoadError(content, e); }
}

/* 讀取失敗：清楚說明並提供重試，不顯示成空白或舊資料 */
function showLoadError(host, e){
  console.error(e);
  host.innerHTML = `<div class="auth card stack"><h1>無法載入資料</h1><p>${esc(errText(e))}</p><button type="button" class="btn primary" id="retryLoad">重新載入</button></div>`;
  host.querySelector('#retryLoad').addEventListener('click', () => location.reload());
}

/* 舊帳號沒有手機號碼（或格式不符）：登入後提示補填，不停用、不刪除、不假裝已有號碼（沿用原型） */
function phoneBanner(me){
  const box = document.createElement('div');
  box.className = 'card hero warn stack'; box.id = 'phoneFill'; box.style.marginBottom = '16px';
  box.innerHTML = `<h2 style="margin:0">請補填手機號碼</h2><p style="margin:0">系統已改為所有帳號都需要手機號碼。您的帳號${me.phone ? `目前的號碼「${esc(me.phone)}」格式不正確` : '還沒有手機號碼'}，請補填；補填前帳號仍可正常使用。</p>
    <form class="stack" id="phoneForm" novalidate><label class="f" data-req>手機號碼<span class="hint">例：0912-345-678</span><input type="tel" name="phone" autocomplete="tel" value="${esc(me.phone || '')}"></label><div class="err" id="pfErr" role="alert"></div><div><button type="submit" class="btn primary">儲存手機號碼</button></div></form>`;
  decorateRequired(box);
  const form = box.querySelector('#phoneForm');
  onSubmit(form, async d => {
    const phone = String(d.get('phone') || '').trim(), m = phoneMsg(phone);
    fieldErr(form, 'phone', m);
    const err = box.querySelector('#pfErr');
    if (m){ err.textContent = m; return; }
    // 確認資料庫寫入成功後才更新畫面
    const { data, error } = await supabase().rpc('update_my_phone', { p_phone: phone });
    if (error){ err.textContent = '儲存失敗：' + errText(error) + '。手機號碼沒有變更，請再試一次。'; return; }
    me.phone = data; box.remove(); toast('手機號碼已儲存');
  });
  return box;
}
