/* 共用畫面工具：跳脫、toast、對話框、必填紅星、欄位錯誤、說明區塊。沿用原型第 (18) 版的做法與文字。
 * 之後的階段會再加上：儲存中／失敗重試、日期與民國年轉換。 */

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg){
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  box.appendChild(el); setTimeout(() => el.remove(), 4500);
}

/* 換頁後才顯示的提示（例如「密碼已更新」後導回首頁）：先存在 sessionStorage，下一頁載入時顯示一次 */
export function setFlash(msg){ try { sessionStorage.setItem('flash', msg); } catch { /* 無法保存就不顯示 */ } }
export function showFlash(){
  try { const m = sessionStorage.getItem('flash'); if (m){ sessionStorage.removeItem('flash'); toast(m); } } catch { /* ignore */ }
}

/* 「這頁要做什麼」說明區塊 */
export const purpose = t => `<p class="purpose"><strong>這頁要做什麼</strong><span>${t}</span></p>`;

/* 狀態標籤；tone：ok／warn／bad／info／mute */
export const pill = (t, tone = 'mute') => `<span class="pill ${tone}">${esc(t)}</span>`;

/* 機構聯絡電話（機構設定有填才顯示） */
export const helpLine = org => org && org.phone ? `<p class="help">需要幫忙嗎？請撥 ${esc(org.phone)}${org.hours ? `（${esc(org.hours)}）` : ''}</p>` : '';

/* 對話框。onOk 回傳字串時當作錯誤訊息顯示在對話框內，不關閉 */
export function modal({ title, body, ok = '確定', cancel = '取消', danger = false, onOk, noCancel = false }){
  const host = document.getElementById('modal');
  host.innerHTML = `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${esc(title)}</h2><div>${body}</div><div class="err" id="merr" role="alert"></div><div class="row end">${noCancel ? '' : `<button type="button" class="btn" data-m="cancel">${esc(cancel)}</button>`}<button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(ok)}</button></div></div></div>`;
  decorateRequired(host);
  const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  host.querySelector('[data-m="cancel"]')?.addEventListener('click', close);
  const okBtn = host.querySelector('[data-m="ok"]');
  okBtn.addEventListener('click', async () => {
    if (okBtn.disabled) return; okBtn.disabled = true;
    try { const err = onOk ? await onOk(host) : ''; if (err) host.querySelector('#merr').textContent = err; else close(); }
    finally { if (document.body.contains(okBtn)) okBtn.disabled = false; }
  });
  (host.querySelector('.dialog input, .dialog select, .dialog textarea') || okBtn).focus();
  return close;
}

/* 必填欄位：標記 data-req 的 label／fieldset 自動加上紅色 *，控制項加 aria-required；表單上方顯示「* 為必填欄位」。
 * 星號只標在實際有驗證的欄位。 */
export function decorateRequired(root){
  if (!root) return;
  root.querySelectorAll('[data-req]').forEach(l => {
    const tgt = l.tagName === 'FIELDSET' ? l.querySelector('legend') : l; if (!tgt) return;
    if (!tgt.querySelector(':scope > .req.auto, :scope > .lbl > .req.auto')){
      const star = document.createElement('span'); star.className = 'req auto'; star.setAttribute('aria-hidden', 'true'); star.textContent = '*';
      /* 欄位名稱是文字節點時包成行內區塊，讓 * 緊接在名稱右側（label 是直式排列） */
      const t = [...tgt.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (t){ const w = document.createElement('span'); w.className = 'lbl'; w.textContent = t.textContent.replace(/\s+$/, ''); w.appendChild(star); t.replaceWith(w); }
      else tgt.prepend(star);
    }
    (l.tagName === 'FIELDSET' ? [...l.querySelectorAll('input,select,textarea')] : [l.querySelector('input,select,textarea')])
      .filter(Boolean).forEach(x => x.setAttribute('aria-required', 'true'));
  });
  root.querySelectorAll('form, .dialog').forEach(f => {
    if (f.querySelector('[data-req]') && !f.querySelector(':scope > .req-note')){
      const p = document.createElement('p'); p.className = 'req-note small';
      p.innerHTML = '<span class="req" aria-hidden="true">*</span> 為必填欄位<span class="sr">（標示星號的欄位必須填寫）</span>';
      f.prepend(p);
    }
  });
}

/* 欄位旁的錯誤訊息（不清空其他已填欄位）；msg 為空字串時清除 */
export function fieldErr(form, name, msg){
  const el = form.querySelector(`[name="${name}"]`); if (!el) return;
  const id = `fe-${form.id}-${name}`; let box = document.getElementById(id);
  if (!msg){ el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); box?.remove(); return; }
  if (!box){ box = document.createElement('div'); box.id = id; box.className = 'ferr'; box.setAttribute('role', 'alert'); (el.closest('label, fieldset') || el).after(box); }
  box.textContent = msg; el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', id);
}

/* 表單送出：送出期間停用按鈕避免重複送出，結束後恢復 */
export function onSubmit(form, fn){
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    if (btn){ if (btn.disabled) return; btn.disabled = true; }
    try { await fn(new FormData(form)); }
    finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });
}

/* 把網路或 Supabase 錯誤轉成給使用者看的說明 */
export function errText(e){
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return '無法連線到伺服器，請確認網路後再試一次';
  return m || '發生未預期的錯誤';
}
