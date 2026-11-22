/* 補件 Email 通知區塊（原型第 (18) 版 reqMailCard；HANDOFF 10.4）。
 * documents.html?view=mail&case=<id> 與 cases.html 的案件詳情共用這一個元件。
 *
 * 列出這個案件每一個正式補件的 Email 通知工作：收件地址、狀態、嘗試次數、最近錯誤。
 *   - 補件存在但通知工作不存在：顯示「待建立／建立失敗」，按「建立並寄送」只建立通知，不會新增補件（send-mail mode=create）
 *   - 寄送失敗、待寄送、寄送中逾時：可以「重試寄送」（send-mail mode=retry）；補件已結案、已被取代的通知不再提供重試
 *   - 文件已確認符合但補件關閉紀錄沒寫入：顯示「資料狀態待修復」與「補寫關閉紀錄」（close_request_fix）
 * 只有行政或承辦護理師可以操作（資料庫與 Edge Function 會再檢查一次）。
 * 測試環境尚未介接郵件服務：「模擬已寄送」不代表家屬已收到真實信件。 */
import { supabase } from '../api/supabase.js';
import { esc, pill, toast, errText, setFlash } from '../ui.js';
import { MAIL_EVENT_WORD, slash } from './rules/core.js';
import { invalidateModel } from './services/model.js';

const CLAIM_MS = 120000;
export const reqMailWord = m => !m ? '待建立／建立失敗' : m.status === '模擬已寄送' ? '模擬已寄送（測試環境未實際寄出）' : m.status === '寄送失敗' ? '寄送失敗，待重試' : m.status === '寄送中' ? '寄送中' : m.status === '已寄送' ? '已寄送' : '待寄送';
const famName = it => String(it.famName || it.name || '').replace(/長輩/g, '住民');

export function reqMailCard(R, D, c, me){
  const ms = Object.values(D.mail || {}).filter(m => m.caseId === c.id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const items = R.caseItems(c.id);
  /* 正式補件已建立，但通知工作沒有建立成功（或尚未建立） */
  const missing = items.filter(it => R.openFormalReq(it, c) && it.req.id && !(D.mail || {})['req_' + it.req.id]);
  const fixes = items.filter(it => R.reqCloseMissing(it, c));
  const can = me.role === 'staff' || (me.role === 'nurse' && c.nurseId === me.id);
  const evOf = m => R.mailReqEvent(m, D.items[m.itemId], c);
  if (!ms.length && !missing.length && !fixes.length) return '';
  const fam = R.acct(c.familyId) || {};
  return `<div class="card stack" id="reqMailCard"><h2>補件 Email 通知（模擬）</h2><p class="small muted" style="margin:0">寄到申請人帳號的電子郵件。測試環境尚未介接郵件服務，「模擬已寄送」不代表家屬已收到真實信件。信件不含病歷、診斷、檢驗數值或身分證字號。</p>${fixes.map(it => `<div class="notice bad" data-closefix="${esc(it.dbId)}"><strong>資料狀態待修復：</strong>「${esc(famName(it))}」已確認符合，但補件請求的關閉紀錄沒有寫入。系統已視為結案，不再寄送這筆補件通知。${can ? ` <button type="button" class="btn sm" data-fixclose="${esc(it.dbId)}">補寫關閉紀錄</button>` : ''}</div>`).join('')}
    <div class="tbl-wrap"><table><thead><tr><th>文件</th><th>原因／期限</th><th>收件</th><th>狀態</th><th></th></tr></thead><tbody>${missing.map(it => `<tr data-missing="${esc(it.dbId)}"><td>${esc(famName(it))}</td><td class="small">${esc(it.req.reason)}${it.req.due ? '<br>期限 ' + slash(it.req.due) : ''}</td><td class="small mono">${esc(fam.notifyEmail || fam.email || '')}</td><td>${pill('待建立／建立失敗', 'bad')}<br><span class="small muted">補件要求已建立，Email 通知工作尚未建立</span></td><td>${can ? `<button type="button" class="btn sm" data-mailcreate="${esc(it.req.id)}">建立並寄送</button>` : ''}</td></tr>`).join('')}${ms.map(m => { const ev = evOf(m); const stale = m.status === '寄送中' && m.claim && Date.now() - (m.claim.ts || 0) >= CLAIM_MS;
      return `<tr data-mail="${esc(m.id)}"><td>${esc(m.docName)}</td><td class="small">${esc(m.reason)}${m.due ? '<br>期限 ' + slash(m.due) : ''}</td><td class="small mono">${esc(m.to)}</td><td>${pill(reqMailWord(m), m.status === '模擬已寄送' ? 'info' : m.status === '寄送失敗' ? 'bad' : 'warn')}<br><span class="small muted">嘗試 ${m.attempts} 次${m.lastError ? '：' + esc(m.lastError) : ''}</span>${ev !== 'open' ? `<br><span class="small" data-evword>${esc(MAIL_EVENT_WORD[ev])}</span>` : ''}</td><td>${can && ev === 'open' && (['寄送失敗', '待寄送'].includes(m.status) || stale) ? `<button type="button" class="btn sm" data-mailretry="${esc(m.id)}">重試寄送</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}

/* 呼叫 send-mail（Edge Function）；回傳第一筆結果 */
export async function sendMail(body){
  const { data, error } = await supabase().functions.invoke('send-mail', { body });
  if (error){ let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* 沿用原訊息 */ } throw new Error(msg); }
  return data;
}
/* 寫入新增或改變補件後：補齊這個案件的補件通知（原型 notifyFamily 後的 syncReqMails）。失敗只提示，案件頁可以重試 */
export async function syncReqMails(caseId){
  try {
    const r = await sendMail({ case_id: caseId, mode: 'sync' });
    const bad = (r.results || []).filter(x => !x.ok && !x.closed);
    if (bad.length) return '補件要求已建立；Email 通知：' + bad.map(x => x.reason).join('、') + '，可以在案件頁重試。';
  } catch (e){ return '補件要求已建立；Email 通知工作建立失敗（' + errText(e) + '），可以在案件頁按「建立並寄送」。'; }
  return '';
}

export function bindReqMailCard(root, c){
  const after = msg => { invalidateModel(); setFlash(msg); location.reload(); };
  root.querySelectorAll('[data-mailcreate]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { const r = (await sendMail({ case_id: c.id, mode: 'create', request_id: b.dataset.mailcreate })).results[0];
      after(r.ok ? '已建立通知工作並模擬寄送（測試環境未實際寄出）' : '沒有完成：' + r.reason);
    } catch (e){ toast('沒有完成：' + errText(e)); b.disabled = false; }
  }));
  root.querySelectorAll('[data-mailretry]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { const r = (await sendMail({ case_id: c.id, mode: 'retry', job_id: b.dataset.mailretry })).results[0];
      after(r.ok ? '已模擬寄送（測試環境未實際寄出）' : '沒有寄出：' + r.reason);
    } catch (e){ toast('沒有寄出：' + errText(e)); b.disabled = false; }
  }));
  root.querySelectorAll('[data-fixclose]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase().rpc('close_request_fix', { p_doc: b.dataset.fixclose });
    if (error){ toast('沒有完成：' + errText(error)); b.disabled = false; return; }
    after('已補寫補件關閉紀錄');
  }));
}
