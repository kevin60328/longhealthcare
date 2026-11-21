/* 家屬端與案件頁共用的畫面片段（原型第 (18) 版同名函式）：
 *   accountCard／bindAccountCard  帳號與通知設定（原型 accountCard、notifyForm）
 *   stepsBar                      申請進度條（原型 stepsBar，資料來自 rules 的 stepsInfo）
 *   timelineCard                  處理歷程（原型 timelineCard，資料來自 rules 的 caseTimeline）
 * 只負責產生 HTML 與綁定事件；判斷規則在 rules/core.js。 */
import { supabase } from '../api/supabase.js';
import { esc, pill, toast, onSubmit, fieldErr, errText } from '../ui.js';
import { isTestEnv } from '../config.js';
import { STEP_CLS, ROLE_NAME } from './rules/core.js';

/* 帳號與通知設定：Email 驗證狀態照實標示（測試環境沒有介接正式郵件服務），通知用 Email 可修改 */
export function accountCard(M){
  const ev = isTestEnv() ? ['測試環境尚未介接', 'warn'] : ['尚未驗證', 'mute'];
  return `<details class="card" id="accountCard"><summary><strong>帳號與通知設定</strong>　${pill('Email：' + ev[0], ev[1])}</summary>
    <p class="small">登入帳號：${esc(M.email)}　手機：${esc(M.phone || '—')}</p>
    <p class="small">電子郵件驗證：${pill(ev[0], ev[1])}<br><span class="muted">目前為測試環境，<strong>通知信尚未介接正式郵件服務</strong>（系統畫面上的寄送都是模擬），也不會顯示「已驗證」。電子郵件驗證只確認信箱可以收信，與個人資料同意書的法律效力無關。</span></p>
    <form class="stack" id="notifyForm" novalidate><label class="f">通知用電子郵件<span class="hint">申請確認等通知會寄到這裡（未來介接郵件服務後）。和登入帳號相同時可以不改。</span><input type="email" name="notifyEmail" value="${esc(M.notifyEmail || M.email)}"></label><div class="err" id="nfErr" role="alert"></div><div><button type="submit" class="btn sm">儲存通知 Email</button></div></form></details>`;
}
export function bindAccountCard(main, M){
  const form = main.querySelector('#notifyForm'); if (!form) return;
  onSubmit(form, async d => {
    const v = String(d.get('notifyEmail') || '').trim(), err = main.querySelector('#nfErr');
    const { data, error } = await supabase().rpc('set_notify_email', { p_email: v === M.email ? '' : v });
    if (error){ fieldErr(form, 'notifyEmail', errText(error)); err.textContent = '儲存失敗：' + errText(error) + '。通知 Email 沒有變更。'; return; }
    fieldErr(form, 'notifyEmail', ''); err.textContent = ''; M.notifyEmail = data || ''; toast('通知 Email 已儲存');
  });
}

/* 申請進度條：每一步顯示實際完成日期（沒有紀錄顯示「日期未記錄」，HANDOFF 9.3） */
export function stepsBar(R, c){
  const info = R.stepsInfo(c), cur0 = info.findIndex(x => x.state !== '已完成');
  return `<ol class="steps" id="stepsBar" aria-label="我的申請進度">${info.map((x, i) => `<li class="${STEP_CLS[x.state]}"${i === cur0 ? ' aria-current="step"' : ''} data-state="${esc(x.state)}"><span class="n" aria-hidden="true">${x.state === '已完成' ? '✓' : x.state === '需重新處理' ? '!' : i + 1}</span><span class="sn">${esc(x.name)}</span><span class="ss">${esc(x.state)}${x.date ? '｜' + esc(x.date) : ''}</span>${x.note ? `<span class="sx">${esc(x.note)}</span>` : ''}</li>`).join('')}</ol>`;
}

/* 處理歷程：依各步驟實際記錄的時間排列；沒有時間的舊資料不顯示，不推測 */
export function timelineCard(R, c, open = false){
  const ev = R.caseTimeline(c);
  const who = id => { const a = R.acct(id); return !id ? '系統' : a ? `${ROLE_NAME[a.role] || ROLE_NAME[a.want] || ''}｜${a.name}` : '（已不存在的帳號）'; };
  const legacy = c.nurseId && !(c.assignHist || []).length ? `舊流程已有承辦護理師（${R.accName(c.nurseId)}），原始分配時間未記錄。` : '';
  return `<details class="card" id="timeline" ${open ? 'open' : ''}><summary><strong>處理歷程（${ev.length} 筆）</strong></summary>
    <p class="small muted">依各步驟實際記錄的時間排列（台灣時間）。舊資料沒有記錄時間的步驟不顯示；時間不會因重新整理頁面而改變。</p>${legacy ? `<p class="small notice info" id="legacyAssign">${esc(legacy)}</p>` : ''}
    <div class="tbl-wrap"><table><thead><tr><th>日期</th><th>時間</th><th>事件</th><th>操作角色｜人員</th><th>說明</th></tr></thead><tbody>${ev.map(e => `<tr><td class="small mono">${esc(e.at.slice(0, 10))}</td><td class="small mono">${esc(e.at.slice(11, 16))}</td><td>${esc(e.t)}</td><td class="small">${esc(who(e.by))}</td><td class="small">${esc(e.note)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">尚無紀錄</td></tr>'}</tbody></table></div></details>`;
}
