/* settings.html：系統管理（HANDOFF 5、6.1、6.2、10.10；原型第 (18) 版 adminAccounts、adminSettings、docListCard、accessCard、adminArchive、adminLogs、adminTestData）。
 * 畫面與文字沿用原型；原型「資料存取與權限」說明寫的是「尚未實作資料庫端權限」，正式版已實作，改寫成實際情況。
 *
 * 網址（只有系統管理員）：
 *   settings.html?view=accounts      帳號管理：核准／退回員工申請、停用／啟用、變更角色、案件分配權限、重設臨時密碼
 *   settings.html?view=org           機構設定：機構資料、補件期限、保存天數、合作醫院、入住流程順序；內建文件清單（唯讀）；資料存取與權限說明
 *   settings.html?view=archive       結案與封存：保存期限、封存（刪除原始檔案）、延長保存
 *   settings.html?view=logs          操作紀錄（每頁 50 筆，只能查詢）
 *   settings.html?view=mail-errors   寄送異常（新增）：寄送失敗、寄送中逾時、待寄送太久、補件存在但沒有通知工作
 *   settings.html?view=testdata      測試資料（只在測試環境）：建立或恢復 T-A～T-D
 *
 * 寫入：帳號、機構設定、延長保存是資料庫 RPC（migrations/…000033_admin.sql，一個交易內檢查管理員身分、寫入、記操作紀錄）；
 *       重設密碼（Auth Admin API）、封存（刪除 Storage 檔案）、測試資料由 Edge Function admin-users／admin-archive／admin-testdata 處理。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { toStamp, todayTW } from './services/model.js';
import { esc, pill, toast, modal, purpose, errText, setFlash } from '../ui.js';
import { isTestEnv } from '../config.js';
import { CATS, NEED_WORD, PHASE_TONE, slash, d2n } from './rules/core.js';
import { ROLE_NAME } from './rules/account.js';

const done = msg => { if (msg) setFlash(msg); location.reload(); };
const fnErr = async (data, error) => { if (!error) return data && data.ok === false ? (data.reason || data.error) : ''; try { return (await error.context.json()).error || error.message; } catch { return error.message; } };

bootPage('settings', async ctx => {
  const { view } = ctx;
  if (view === 'org') return orgPage(ctx);
  if (view === 'archive') return archivePage(ctx);
  if (view === 'logs') return logsPage(ctx);
  if (view === 'mail-errors') return mailPage(ctx);
  if (view === 'testdata') return isTestEnv() ? testPage(ctx) : void (ctx.main.innerHTML = '<div class="card"><h1>測試資料</h1><p>正式環境沒有這個功能。</p></div>');
  return accountsPage(ctx);
});

/* ========== 帳號管理（原型 adminAccounts） ==========
 * 「最後登入」：原型記在帳號（lastLogin），正式版 profiles.last_login_at（record_login 寫入）。管理員可據此找出很久沒使用、應停用的帳號（2026/11/28 資料庫清理時決定顯示） */
async function accountsPage({ main, me }){
  const { data, error } = await supabase().from('profiles').select('id, email, name, role, want, status, phone, can_assign_nurse, created_at, last_login_at');
  if (error) throw error;
  const list = data.sort((a, b) => (a.status === '待審核' ? 0 : 1) - (b.status === '待審核' ? 0 : 1) || String(b.created_at).localeCompare(String(a.created_at)));
  const pending = list.filter(a => a.status === '待審核');
  main.innerHTML = `<h1>帳號管理</h1>${purpose('核准機構人員的角色申請、變更職務角色、停用帳號，或為忘記密碼的使用者重設臨時密碼。家屬帳號註冊後即可使用，由行政確認其與住民的關係。')}
  ${pending.length ? `<div class="card" style="margin-bottom:14px" id="pendingCard"><h2>待審核（${pending.length}）</h2><ul class="tasks">${pending.map(a => `<li class="task">${pill('待審核', 'warn')}<div><div class="what">${esc(a.name)}　申請「${esc(ROLE_NAME[a.want] || a.want)}」</div><div class="small muted">${esc(a.email)}　${esc(a.phone || '')}　${esc(toStamp(a.created_at) || '')}</div></div><span class="row"><button type="button" class="btn sm primary" data-approve="${a.id}">核准</button><button type="button" class="btn sm" data-reject="${a.id}">退回</button></span></li>`).join('')}</ul></div>` : ''}
  <div class="card tbl-wrap"><table><thead><tr><th>姓名</th><th>電子郵件</th><th>角色</th><th>狀態</th><th>最後登入</th><th></th></tr></thead><tbody id="accRows">
  ${list.filter(a => a.status !== '待審核').map(a => `<tr data-acc="${esc(a.email)}"><td>${esc(a.name)}</td><td class="small">${esc(a.email)}</td><td>${esc(ROLE_NAME[a.role] || ROLE_NAME[a.want] || '')}${a.can_assign_nurse && a.role === 'nurse' ? '<br>' + pill('案件分配權限', 'info') : ''}</td><td>${pill(a.status, a.status === '啟用' ? 'ok' : 'mute')}</td><td class="small">${a.last_login_at ? esc(toStamp(a.last_login_at)) : '<span class="muted">尚未登入</span>'}</td><td><span class="row">${a.id !== me.id ? `${a.status === '啟用' ? `<button type="button" class="btn sm" data-disable="${a.id}">停用</button>` : a.status === '停用' ? `<button type="button" class="btn sm" data-enable="${a.id}">啟用</button>` : ''}${a.role && a.role !== 'family' && a.status === '啟用' ? `<button type="button" class="btn sm" data-role="${a.id}">變更角色</button>` : ''}${a.role === 'nurse' && a.status === '啟用' ? `<button type="button" class="btn sm" data-assign="${a.id}">${a.can_assign_nurse ? '取消案件分配權限' : '開啟案件分配權限'}</button>` : ''}<button type="button" class="btn sm" data-reset="${a.id}">重設密碼</button>` : '<span class="small muted">（您）</span>'}</span></td></tr>`).join('')}
  </tbody></table></div>`;
  const acc = id => list.find(a => a.id === id);
  const rpcModal = (title, body, ok, fn, opts = {}) => modal({ title, body, ok, ...opts, onOk: async host => { const e = await fn(host); if (e) return e; return ''; } });
  main.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.approve);
    rpcModal('核准角色', `<p>核准 ${esc(a.name)} 成為「${esc(ROLE_NAME[a.want])}」？核准後即可登入並查看被指派的資料。</p>`, '核准', async () => { const { error } = await supabase().rpc('approve_account', { p_id: a.id }); if (error) return '核准失敗：' + errText(error); done('已核准'); }); }));
  main.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.reject);
    rpcModal('退回申請', `<p>退回 ${esc(a.name)} 的角色申請？</p>`, '退回', async () => { const { error } = await supabase().rpc('reject_account', { p_id: a.id }); if (error) return '退回失敗：' + errText(error); done('已退回'); }, { danger: true }); }));
  main.querySelectorAll('[data-disable]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.disable);
    rpcModal('停用帳號', `<p>停用後 ${esc(a.name)} 將無法使用系統。</p>`, '停用', async () => { const { error } = await supabase().rpc('set_account_status', { p_id: a.id, p_status: '停用' }); if (error) return '停用帳號失敗：' + errText(error); done('已停用'); }, { danger: true }); }));
  main.querySelectorAll('[data-enable]').forEach(b => b.addEventListener('click', async () => { b.disabled = true;
    const { error } = await supabase().rpc('set_account_status', { p_id: b.dataset.enable, p_status: '啟用' }); if (error){ b.disabled = false; return toast('啟用帳號失敗：' + errText(error)); } done('已啟用'); }));
  main.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.role);
    rpcModal('變更角色', `<p>${esc(a.name)} 目前是「${esc(ROLE_NAME[a.role])}」。</p><label class="f">新的角色<select id="newRole">${['staff', 'nurse', 'care', 'admin'].map(r => `<option value="${r}" ${a.role === r ? 'selected' : ''}>${ROLE_NAME[r]}</option>`).join('')}</select></label><p class="small muted">變更後立即生效。若原本是護理師，請由具案件分配權限的護理人員改派承辦案件。</p>`, '變更', async host => {
      const r = host.querySelector('#newRole').value; if (r === a.role) return void done('');
      const { data, error } = await supabase().rpc('set_account_role', { p_id: a.id, p_role: r }); if (error) return '變更角色失敗：' + errText(error);
      done(data ? `已變更。還有 ${data} 件案件需要由具案件分配權限的護理人員改派` : '已變更角色'); }); }));
  main.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.assign), on = !a.can_assign_nurse;
    rpcModal(on ? '開啟案件分配權限' : '取消案件分配權限', `<p>${esc(a.name)}（${esc(ROLE_NAME[a.role])}）${on ? '開啟後可以查看待分配案件、指定與更換承辦護理師。角色不變。' : '取消後不能再分配案件；已分配的案件不受影響。'}</p>`, on ? '開啟' : '取消權限', async () => {
      const { error } = await supabase().rpc('set_assign_permission', { p_id: a.id, p_on: on }); if (error) return '設定權限失敗：' + errText(error); done('已更新'); }); }));
  main.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => { const a = acc(b.dataset.reset);
    rpcModal('重設密碼', `<p>為 ${esc(a.name)} 產生一組臨時密碼。對方第一次登入時必須改成自己的密碼。</p>`, '產生臨時密碼', async () => {
      const { data, error } = await supabase().functions.invoke('admin-users', { body: { action: 'reset', user_id: a.id } });
      const e = await fnErr(data, error); if (e) return '重設密碼失敗：' + e;
      setTimeout(() => modal({ title: '臨時密碼', ok: '完成', noCancel: true, body: `<p>請將臨時密碼告知 ${esc(a.name)}（建議當面或電話告知）：</p><p class="mono" style="font-size:1.3rem" id="tmpPw">${esc(data.password)}</p><p class="small muted">這組密碼只會顯示這一次。</p>` }), 0); }); }));
}

/* ========== 機構設定（原型 adminSettings、docListCard、accessCard） ========== */
/* 資料存取與權限：說明實際的保護方式（原型寫「尚未實作」，正式版已實作 RLS、Storage policy 與 RPC） */
const ACCESS_ROWS = [
  ['家屬／申請人', '自己申請的住民：申請資料、文件清單、上傳的檔案、通知、習慣卡', 'RLS：只能讀自己案件（family_id = 本人）；Storage 只能讀寫自己案件的資料夾；寫入走 RPC'],
  ['行政／社工', '所有進行中的案件、身分與契約文件；不判斷醫療內容', 'RLS 可讀全部案件與文件；打開醫療類（B、C、D）檔案前必須經過記錄（每人每版本一筆操作紀錄）'],
  ['護理人員', '指派給自己的住民；健康檢查、醫療、照護文件', 'RLS 與 Storage：只限 nurse_id = 本人且文件類別 B／C／D；有分配權限的護理師另外可看案件基本資料（不含文件）'],
  ['照顧服務員', '被授權住民的照護摘要卡，不能看原始文件、證件、契約、費用', '只能讀開放給自己且已開放的摘要卡（Edge Function 只回傳摘要卡）；不能讀案件、文件與 Storage'],
  ['系統管理員', '帳號、機構設定、操作紀錄、封存', '帳號與設定走 RPC；操作紀錄只能新增、不能修改或刪除（資料庫觸發器）；看不到文件內容']
];
async function orgPage({ main }){
  const [o, h, cat, parts] = await Promise.all([supabase().from('org_settings').select('*').eq('id', 1).single(), supabase().from('partner_hospitals').select('name').eq('active', true).order('sort'),
    supabase().from('doc_catalog').select('*').eq('on_demand', false).order('sort'), supabase().from('doc_catalog_parts').select('catalog_key, name, sort').order('sort')]);
  for (const r of [o, h, cat, parts]) if (r.error) throw r.error;
  const org = o.data, partsOf = k => parts.data.filter(p => p.catalog_key === k);
  const docList = `<details class="card stack" id="docListRef"><summary><strong>內建入住文件清單（${cat.data.length} 項＋聯絡人表單＋資料授權線上簽署）</strong></summary>
    <p class="small notice warn">檢查項目與有效天數是本系統<strong>示範機構的參考設定</strong>，不是全國通用規定。</p>
    <div class="tbl-wrap"><table><thead><tr><th>文件</th><th>是否需要繳交</th><th>什麼時候要交</th><th>有效天數</th><th>核對</th></tr></thead><tbody>${Object.keys(CATS).map(k => { const rs = cat.data.filter(r => r.cat === k); const extra = k === 'A' ? '<tr><td>緊急聯絡人資料</td><td>需要填寫（系統表單）</td><td>評估前</td><td>—</td><td>—</td></tr>' : k === 'E' ? '<tr><td>個人資料蒐集、處理及利用同意書</td><td>需要簽署（線上簽署）</td><td>一開始</td><td>—</td><td>—</td></tr>' : k === 'G' ? '<tr><td colspan="5" class="small muted">行政依個案在案件頁新增（不需要管理員設定）</td></tr>' : ''; return `<tr class="cat"><th colspan="5">${k}. ${esc(CATS[k])}</th></tr>` + rs.map(r => `<tr><td>${esc(r.name)}${partsOf(r.key).length ? `<br><span class="small muted">核對項目：${esc(partsOf(r.key).map(p => p.name).join('、'))}</span>` : ''}</td><td>${esc(NEED_WORD[r.need])}${r.cond ? `<br><span class="small muted">${esc(r.cond)}</span>` : ''}</td><td>${r.stage === '入住前' ? '簽約後（入住前）' : '評估前'}</td><td>${r.valid_days || '不限'}</td><td>${r.medical ? '護理' : '行政'}</td></tr>`).join('') + extra; }).join('')}</tbody></table></div></details>`;
  const access = `<div class="card stack" id="accessCard"><h2>資料存取與權限</h2>
    <p class="notice info small">每個角色能看到的範圍由<strong>資料庫權限（RLS）、檔案權限（Storage policy）與後端函式</strong>控管，不只是畫面隱藏。各項權限都有自動測試（tests/rls）。</p>
    <div class="tbl-wrap"><table><thead><tr><th>角色</th><th>能看到的範圍</th><th>實際的保護方式</th></tr></thead><tbody>${ACCESS_ROWS.map(r => `<tr><td>${esc(r[0])}</td><td class="small">${esc(r[1])}</td><td class="small">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">文件檔案放在私有儲存空間，以 10 分鐘有效的網址存取；service role 金鑰、Claude API key 只放在後端（Edge Functions），不在前端。</p></div>`;
  main.innerHTML = `<h1>機構設定</h1>${purpose('設定機構資料、補件期限與入住流程順序。入住文件清單由系統內建，不需要另外設定；個案的特殊文件由行政在案件頁新增。')}
  <form class="stack" id="settingsForm" novalidate>
    <div class="card stack"><h2>機構資料</h2>
      <label class="f">機構名稱<input type="text" name="name" value="${esc(org.name)}"></label>
      <div class="grid2"><label class="f">聯絡電話<input type="text" name="phone" value="${esc(org.phone)}"></label><label class="f">服務時間<input type="text" name="hours" value="${esc(org.hours)}"></label></div></div>
    <div class="card stack"><h2>期限與保存</h2>
      <div class="grid2"><label class="f">補件期限（天）<span class="hint">通知家屬補件後幾天內要上傳，逾期會出現在行政的補件追蹤</span><input type="number" min="1" max="60" name="requestDays" value="${org.request_days}"></label>
      <label class="f">結案資料保存天數<span class="hint">未入住案件結案後保存多久，到期後可封存並刪除原始檔案</span><input type="number" min="30" name="retentionDays" value="${org.retention_days}"></label></div></div>
    <div class="card stack"><h2>合作醫院與轉介單位</h2>
      <label class="f">每行一家<span class="hint">家屬填寫申請時可以直接選擇</span><textarea name="partners" rows="4">${esc(h.data.map(x => x.name).join('\n'))}</textarea></label></div>
    <div class="card stack"><h2>入住流程順序</h2>
      <label class="choice"><input type="radio" name="mode" value="先審後簽" ${org.flow_mode === '先審後簽' ? 'checked' : ''}><span><strong>先審後簽（建議）</strong>：先看文件評估，通過後再參訪簽約</span></label>
      <!-- 客戶回饋（2026/11/23，使用者決定）：多數機構是先審後簽，先簽後審保留（HANDOFF 3.1 不能刪）但收在「其他流程」並加說明；
           目前設定是先簽後審時自動展開，管理員一定看得到目前的選擇 -->
      <details id="flowOther" ${org.flow_mode === '先簽後審' ? 'open' : ''}><summary class="small">其他流程（少數機構使用）</summary>
        <label class="choice"><input type="radio" name="mode" value="先簽後審" ${org.flow_mode === '先簽後審' ? 'checked' : ''}><span><strong>先簽後審</strong>：先參訪簽約，入住前再交醫療資料確認</span></label>
        <p class="small muted" style="margin:0">護理確認在簽約之後；入住前確認結果不適合時，要再和家屬協調或結案。</p>
      </details>
      <p class="small muted" style="margin:0">變更只影響之後新建的申請；已建立的案件維持建立時的流程。</p></div>
    <div class="err" id="setErr" role="alert"></div>
    <div class="row end"><button type="submit" class="btn primary">儲存設定</button></div>
  </form>${docList}${access}`;
  const f = main.querySelector('#settingsForm');
  f.addEventListener('submit', async e => {
    e.preventDefault(); const d = new FormData(f), btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    btn.disabled = true;
    const { error } = await supabase().rpc('update_org_settings', { p_rev: org.rev, p_name: String(d.get('name') || '').trim(), p_phone: String(d.get('phone') || '').trim(), p_hours: String(d.get('hours') || '').trim(),
      p_request_days: Number(d.get('requestDays')), p_retention_days: Number(d.get('retentionDays')), p_flow_mode: d.get('mode'), p_partners: String(d.get('partners') || '').split('\n').map(x => x.trim()).filter(Boolean) });
    if (error){ btn.disabled = false; main.querySelector('#setErr').textContent = '儲存失敗：' + errText(error) + '。'; return; }
    done('已儲存設定');
  });
}

/* ========== 結案與封存（原型 adminArchive、archive、retain-hold） ========== */
async function archivePage({ main }){
  const [l, o] = await Promise.all([supabase().rpc('admin_archive_list'), supabase().from('org_settings').select('retention_days').eq('id', 1).single()]);
  if (l.error) throw l.error;
  const keep = o.data.retention_days, today = todayTW();
  const rows = l.data.map(c => { const d = (toStamp(c.closed_at) || '').slice(0, 10).replace(/\//g, '-'); const age = d ? d2n(today) - d2n(d) : 0; return { c, d, age, due: !c.archived_at && age >= keep, hold: c.hold && c.hold.until >= today ? c.hold : null }; })
    .sort((a, b) => (a.c.archived_at ? 1 : 0) - (b.c.archived_at ? 1 : 0) || b.age - a.age);
  const dueN = rows.filter(x => x.due).length;
  main.innerHTML = `<h1>結案與封存</h1>${purpose(`未入住的案件結案後保存 ${keep} 天（可在機構設定修改）。到期後請封存：系統會<strong>刪除原始檔案</strong>，只保留結案原因與操作紀錄。封存後無法復原。有法定保存義務、爭議或調查時，請先按「延長保存」。本版由管理員手動執行，到期自動刪除屬第二階段。`)}
  <div class="tiles"><div class="tile ${dueN ? 'alert' : ''}"><div class="n">${dueN}</div>件已到保存期限</div><div class="tile"><div class="n">${rows.filter(x => !x.c.archived_at).length}</div>件已結案保存中</div><div class="tile"><div class="n">${rows.filter(x => x.c.archived_at).length}</div>件已封存</div></div>
  <div class="card tbl-wrap"><table><thead><tr><th>編號</th><th>住民</th><th>結案原因</th><th>結案日</th><th>狀態</th><th></th></tr></thead><tbody id="arcRows">
  ${rows.map(({ c, d, age, due, hold }) => `<tr data-no="${esc(c.no)}"><td class="mono">${esc(c.no)}</td><td>${esc(c.name)}</td><td class="small">${esc(c.closed_reason || c.closed_title || '')}</td><td>${slash(d)}<br><span class="small muted">已 ${age} 天</span></td><td>${c.archived_at ? pill('已封存', 'mute') + `<br><span class="small muted">${esc(toStamp(c.archived_at))}</span>` : due ? pill('已到期', 'bad') : pill(`還有 ${keep - age} 天`, 'info')}</td><td>${c.archived_at ? (c.archive_status === '處理未完成' ? pill('處理未完成', 'bad') : '') : hold ? `${pill('延長保存', 'warn')}<br><span class="small muted">至 ${slash(hold.until)}（${esc(hold.type)}）</span>` : `<span class="row"><button type="button" class="btn sm ${due ? 'danger' : ''}" data-archive="${c.id}">封存</button><button type="button" class="btn sm" data-hold="${c.id}">延長保存</button></span>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">目前沒有結案的案件。</td></tr>'}
  </tbody></table></div>`;
  const row = id => rows.find(x => x.c.id === id).c;
  main.querySelectorAll('[data-hold]').forEach(b => b.addEventListener('click', () => modal({ title: '延長保存', ok: '延長保存',
    body: `<label class="f" data-req>保留原因<select id="rhType"><option>法定保存義務</option><option>爭議處理中</option><option>主管機關調查</option><option>其他</option></select></label><label class="f">說明<input type="text" id="rhNote"></label><label class="f">保存到<input type="date" id="rhUntil" min="${today}"></label>`,
    onOk: async host => { const until = host.querySelector('#rhUntil').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return '請選擇保存期限';
      const { error } = await supabase().rpc('add_retention_hold', { p_case: b.dataset.hold, p_type: host.querySelector('#rhType').value, p_note: host.querySelector('#rhNote').value.trim(), p_until: until });
      if (error) return '延長保存失敗：' + errText(error); done('已延長保存'); return ''; } })));
  main.querySelectorAll('[data-archive]').forEach(b => b.addEventListener('click', () => { const c = row(b.dataset.archive);
    modal({ title: '封存案件', ok: '封存並刪除檔案', danger: true, body: `<p>封存「${esc(c.name)}（${esc(c.no)}）」後：</p><ul><li>上傳的原始檔案與 AI 辨識暫存會<strong>永久刪除</strong></li><li>保留結案原因、文件清單與操作紀錄</li><li>無法復原</li></ul><label class="choice"><input type="checkbox" id="arChk"><span>我已確認此案件沒有需要延長保存的原因（法定保存義務、爭議、調查）</span></label>`,
      onOk: async host => { if (!host.querySelector('#arChk').checked) return '請先確認沒有延長保存的原因';
        const { data, error } = await supabase().functions.invoke('admin-archive', { body: { case_id: c.id } });
        const e = await fnErr(data, error); if (e) return '封存失敗：' + e;
        done(data.failed ? `有 ${data.failed} 份檔案刪除失敗，狀態為「處理未完成」` : '已封存'); return ''; } }); }));
}

/* ========== 操作紀錄（原型 adminLogs；正式版每頁 50 筆，可往前翻頁） ========== */
async function logsPage({ main, params }){
  const size = 50, page = Math.max(0, Number(params.get('page')) || 0);
  const { data, error, count } = await supabase().from('audit_logs').select('id, at, actor_name, role, action, cases(no)', { count: 'exact' }).order('id', { ascending: false }).range(page * size, page * size + size - 1);
  if (error) throw error;
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  main.innerHTML = `<h1>操作紀錄</h1><p class="lead">共 ${count || 0} 筆，依時間由新到舊，每頁 ${size} 筆。只能查詢，不能修改或刪除。</p>
  <div class="card tbl-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>案件</th><th>內容</th></tr></thead><tbody id="logRows">
  ${data.map(l => `<tr><td class="small mono">${esc(toStamp(l.at))}</td><td class="small">${esc(l.actor_name || '系統')}${l.role ? `<br><span class="muted">${esc(ROLE_NAME[l.role] || l.role)}</span>` : ''}</td><td class="small mono">${esc((l.cases || {}).no || '')}</td><td>${esc(l.action)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">尚無紀錄</td></tr>'}
  </tbody></table></div>
  <nav class="row between" aria-label="翻頁" style="margin-top:12px">${page > 0 ? `<a class="btn sm" href="settings.html?view=logs&page=${page - 1}">← 較新的紀錄</a>` : '<span></span>'}<span class="small muted">第 ${page + 1}／${pages} 頁</span>${page + 1 < pages ? `<a class="btn sm" href="settings.html?view=logs&page=${page + 1}">較舊的紀錄 →</a>` : '<span></span>'}</nav>`;
}

/* ========== 寄送異常（HANDOFF 6.2 新增） ========== */
async function mailPage({ main }){
  const { data, error } = await supabase().rpc('admin_mail_issues');
  if (error) throw error;
  const EV = { closed: '補件已結案，不再寄送', replaced: '已有下一次補件，不再寄送', gone: '文件已移除', missing: '文件已確認符合，補件關閉紀錄待補寫' };
  main.innerHTML = `<h1>寄送異常</h1>${purpose('列出需要處理的補件 Email 通知：寄送失敗、寄送中超過 2 分鐘沒有結果、待寄送超過 10 分鐘，以及補件已建立但通知工作沒有建立成功。重試寄送請由行政或承辦護理師在案件頁的「補件 Email 通知」處理。')}
  <p class="notice info small">測試環境尚未介接郵件服務：「模擬已寄送」不代表家屬已收到真實信件。信件不含病歷、診斷、檢驗數值或身分證字號。</p>
  <div class="card tbl-wrap"><table><thead><tr><th>案件</th><th>文件／原因</th><th>收件</th><th>狀態</th><th>最近更新</th></tr></thead><tbody id="mailRows">
  ${data.map(m => `<tr><td><span class="mono">${esc(m.no)}</span><br>${esc(m.name)}</td><td>${esc(m.doc)}<br><span class="small muted">${esc(m.reason || '')}</span></td><td class="small mono">${esc(m.to_email || '—')}</td><td>${pill(m.status, /失敗|建立/.test(m.status) ? 'bad' : 'warn')}<br><span class="small muted">嘗試 ${m.attempts} 次${m.last_error ? '：' + esc(m.last_error) : ''}</span>${m.event && m.event !== 'open' ? `<br><span class="small">${esc(EV[m.event] || '')}</span>` : ''}</td><td class="small">${esc(toStamp(m.at) || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">目前沒有寄送異常。</td></tr>'}
  </tbody></table></div>`;
}

/* ========== 測試資料（原型 adminTestData；只在測試環境） ========== */
const SPEC_TEXT = {
  'T-A': ['從護理人員的醫療文件人工核對開始測試（含 AI 辨識）', '評估前文件都已上傳、行政已完成身分核對；7 份醫療文件「待護理核對」，護理欄位全部空白'],
  'T-B': ['直接測試護理收治評估（先審後簽）', '評估前必要文件都已由行政與護理確認；管路、傷口判斷為本案不需要；選填文件未上傳；尚未評估'],
  'T-C': ['由您親自審核並開放照顧摘要卡，再用照服員查看', '收治評估「收治」、已簽約、入住前文件全部確認；家屬已填習慣卡；摘要卡尚未審核'],
  'T-D': ['直接測試照服員查看已開放的摘要卡；也可測試資料更新後重新確認', '先簽後審：已簽約、入住前護理確認「可入住」、摘要卡第 1 版已開放給阿妮']
};
async function testPage({ main }){
  const { data, error } = await supabase().functions.invoke('admin-testdata', { body: { action: 'status' } });
  const e = await fnErr(data, error); if (e){ main.innerHTML = `<div class="card"><h1>測試資料</h1><p class="err">${esc(e)}</p></div>`; return; }
  main.innerHTML = `<h1>測試資料（僅供測試）</h1>${purpose('只在測試環境使用。建立或恢復固定編號的虛構測試案件，方便直接從護理核對、收治評估、摘要卡與照服員畫面開始人工審核。不會在開啟頁面時自動執行，也不會影響其他案件。')}
  <div class="notice warn stack" style="margin-bottom:14px"><strong>僅供測試</strong><span class="small">所有住民、家屬、醫院與文件都是虛構的模擬資料。案件狀態是用完整資料建立（家屬上傳、行政核對、日期確認、護理確認），審核條件與正式流程相同。預先完成的護理確認標示為「測試資料預先確認」，不是 AI 辨識結果。測試案件沒有實際的文件檔案。</span></div>
  <div class="card tbl-wrap"><table><thead><tr><th>測試案件</th><th>家屬／護理</th><th>起始狀態</th><th>目前狀態</th><th></th></tr></thead><tbody id="testRows">
  ${data.specs.map(s => { const [use, start] = SPEC_TEXT[s.no] || ['', '']; return `<tr data-no="${esc(s.no)}"><td><strong>${esc(s.label)}</strong><br><span class="small">${esc(s.name)}（${esc(s.flow)}）</span><br><span class="small muted">${esc(use)}</span></td><td class="small">${esc(s.family)}（${esc(s.relation)}）<br>${esc(s.nurse)}${s.caregivers.length ? '<br>照服員：' + esc(s.caregivers.join('、')) : ''}</td><td class="small">${esc(start)}</td><td>${s.exists ? pill(s.phase, PHASE_TONE[s.phase]) : pill('尚未建立', 'mute')}</td><td><button type="button" class="btn sm ${s.exists ? '' : 'primary'}" data-seed="${esc(s.no)}" data-exists="${s.exists ? 1 : ''}">${s.exists ? '恢復起始狀態' : '建立'}</button></td></tr>`; }).join('')}
  </tbody></table></div>
  <div class="row" style="margin-top:12px"><button type="button" class="btn" id="seedMissing">建立尚未存在的測試案件</button></div>
  <p class="small muted">恢復起始狀態會刪除該筆測試案件上的所有人工操作（文件、核對、評估、摘要卡、通知、上傳的檔案與這筆案件的操作紀錄）後重建；其他案件與帳號不受影響。測試環境以外沒有這個功能。</p>`;
  const run = async (body, msg) => { const { data: r, error: er } = await supabase().functions.invoke('admin-testdata', { body }); const x = await fnErr(r, er); if (x) return '未完成：' + x + '。可以再按一次。'; done(r.note || msg); return ''; };
  main.querySelectorAll('[data-seed]').forEach(b => b.addEventListener('click', () => { const ex = !!b.dataset.exists, s = data.specs.find(x => x.no === b.dataset.seed);
    modal({ title: ex ? `恢復起始狀態：${s.label}` : `建立：${s.label}`, ok: ex ? '確認恢復' : '建立', danger: ex,
      body: `<p class="notice warn small">僅供測試</p>${ex ? `<p>會<strong>刪除後重建</strong>「${esc(s.name)}」的測試資料，您在這筆案件上的人工操作都會被清除。</p><p class="small muted">其他案件與帳號不受影響。</p>` : ''}<p class="small">起始狀態：${esc((SPEC_TEXT[s.no] || ['', ''])[1])}</p>`,
      onOk: () => run({ action: 'seed', nos: [s.no] }, `已${ex ? '恢復' : '建立'}：${s.label}`) }); }));
  main.querySelector('#seedMissing').addEventListener('click', () => modal({ title: '建立尚未存在的測試案件', ok: '建立', body: '<p class="notice warn small">僅供測試</p><p class="small muted">已存在的測試案件不會被改動。</p>', onOk: () => run({ action: 'missing' }, '已建立尚未存在的測試案件') }));
}
