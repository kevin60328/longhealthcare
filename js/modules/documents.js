/* documents.html：文件與補件管理（HANDOFF 6.1、6.2；原型第 (18) 版 familyGuide、familyUpload、familyUploaded、staffReceipt、
 * staffSignerReceipt、staffDate、staffFollowup、docPage、reqMailCard，以及案件頁的 doc-add、staff-request、inst-up 對話框）。
 * 畫面與文字沿用原型。
 *
 * 網址（item＝文件的資料庫 id；case 可省略，會由文件推得）：
 *   家屬  ?view=list[&case=<id>]                 申請流程說明與完整文件清單（只供查閱）
 *         ?view=upload&case=<id>&item=<id>       上傳文件（或沿用已上傳的體檢報告／其他文件）
 *         ?view=uploaded&case=<id>&item=<id>     已上傳，等待審核
 *   行政  ?view=followup                         補件追蹤（預設畫面）
 *         ?view=receipt&item=<id>                收件核對（簽約者身分證明另有畫面）
 *         ?view=date&item=<id>                   核對文件日期（可用 AI 讀取日期）
 *         ?view=request&case=<id>                要求家屬補件
 *         ?view=add&case=<id>                    新增其他指定文件
 *         ?view=inst&case=<id>&item=<id>         上傳／登錄機構提供的文件
 *         ?view=mail&case=<id>                   補件 Email 通知
 *   行政、承辦護理  ?view=doc&item=<id>[&v=<版本>]  看文件（只能查看）；護理只看 B、C、D 類
 *   from=case／from=home：從案件頁／工作清單進來（返回連結與導覽列分頁依此決定）
 *
 * 原型用對話框的「要求補件、新增其他文件、上傳機構文件」，拆頁後改成獨立畫面（表單內容與文字相同），
 * 因為案件頁的按鈕連到這一頁（HANDOFF 6.2 的網址規劃）。
 *
 * 寫入一律呼叫資料庫 RPC（migrations/…000023_documents.sql）：一個交易內檢查權限與狀態、寫入、通知家屬、記錄操作紀錄；
 * 確認成功後才更新畫面，失敗時顯示原因、已填內容與已選的檔案保留，可以再按一次（HANDOFF 3.4）。
 * 檔案在 Storage 私有 bucket，看檔案用 10 分鐘有效的網址（services/files.js）。
 * AI 辨識（日期、出生日期）由 Edge Function ocr 呼叫 Claude；結果只是建議，仍須人工確認。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel, invalidateModel, todayTW } from './services/model.js';
import { uploadFile, openFile, fileProblem, OCR_TYPES } from './services/files.js';
import { reqMailCard, bindReqMailCard, syncReqMails } from './mail-ui.js';
import { esc, pill, toast, modal, purpose, errText, setFlash, helpLine } from '../ui.js';
import { TONE, FAMILY_WORD, CATS, NEED_TONE, slash, md, uiT, isDate, d2n } from './rules/core.js';
import { ID_ROWS, ID_LABEL, idProfile, MANUAL_HOW, birthCompare, birthSlash, BIRTH_TONE } from './rules/receipt.js';
import { fieldDefs } from './rules/fields.js';

const P = (t, tone) => pill(t, tone || TONE[t] || 'mute');
const backLink = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const famName = i => uiT(i.famName || i.name);
const docUrl = (view, it, extra = '') => `documents.html?view=${view}&case=${it.caseId}&item=${it.dbId}${extra}`;
/* 寫入成功後：清掉快取、顯示提示並前往下一個畫面 */
const done = (msg, url) => { invalidateModel(); if (msg) setFlash(msg); if (url) location.assign(url); else location.reload(); };

bootPage('documents', async ctx => {
  const { me, params, main } = ctx;
  const view = ctx.view || (me.role === 'family' ? 'list' : me.role === 'staff' ? 'followup' : 'doc');
  const from = params.get('from') || '';
  let caseId = params.get('case'); const itemDb = params.get('item');
  if (itemDb && !caseId){ const { data } = await supabase().from('documents').select('case_id').eq('id', itemDb).maybeSingle(); caseId = data?.case_id || null; }
  const ok = { family: ['list', 'upload', 'uploaded'], staff: ['receipt', 'date', 'followup', 'doc', 'add', 'request', 'inst', 'mail'], nurse: ['doc'] }[me.role] || [];
  if (!ok.includes(view)){ main.innerHTML = `<div class="auth card stack"><h1>沒有權限</h1><p>您的帳號（${esc(me.name)}）不能使用這個畫面。</p><a class="btn primary" href="dashboard.html">回到首頁</a></div>`; return; }

  const all = view === 'followup' || (me.role === 'family' && view === 'list');
  const model = await loadModel(me, all ? {} : { caseId });
  const x = { ...ctx, view, from, D: model.D, R: model.R, M: model.me };
  if (view === 'followup') return followupPage(x);
  if (view === 'list') return guidePage(x);
  const c = model.D.cases[caseId];
  if (!c){ main.innerHTML = '<div class="card stack"><h1>找不到這個案件或文件</h1><p>可能已經刪除，或您沒有權限查看。</p><a class="btn primary" href="dashboard.html">回到首頁</a></div>'; return; }
  const it = itemDb ? Object.values(model.D.items).find(i => i.dbId === itemDb && i.caseId === c.id) : null;
  if (itemDb && !it){ main.innerHTML = '<div class="card stack"><h1>找不到這份文件</h1><p>可能已經刪除，或您沒有權限查看。</p><a class="btn primary" href="dashboard.html">回到首頁</a></div>'; return; }
  const y = { ...x, c, it, back: backFor(me, c, from) };
  switch (view){
    case 'upload': return uploadPage(y);
    case 'uploaded': return uploadedPage(y);
    case 'receipt': return it.key === 'signerId' ? signerReceiptPage(y) : receiptPage(y);
    case 'date': return datePage(y);
    case 'doc': return docPage(y);
    case 'request': return requestPage(y);
    case 'add': return addPage(y);
    case 'inst': return instPage(y);
    case 'mail': return mailPage(y);
  }
});

/* 返回連結：家屬回案件首頁；行政從案件頁來回案件，否則回工作清單；護理回住民資料 */
function backFor(me, c, from){
  if (me.role === 'family') return backLink(`application.html?case=${c.id}`, '回到首頁');
  if (me.role === 'nurse') return backLink(`assessment.html?case=${c.id}`, '回到住民資料');
  return from === 'case' ? backLink(`cases.html?case=${c.id}`, '回到案件') : backLink('dashboard.html', '回到工作清單');
}
/* 行政完成收件類動作後回到哪裡：從案件頁來回案件，否則回工作清單（原型 go('home')） */
const afterUrl = (c, from) => from === 'case' ? `cases.html?case=${c.id}` : 'dashboard.html';

/* 無法處理（原型 blocked）：授權撤回、結案、封存、尚未授權 */
function blocked(R, c, back){
  const cs = R.consentState(c);
  const why = cs === '已撤回' ? `家屬已於 ${esc(c.consent.withdrawnAt || '')} 撤回資料授權（第 ${esc(c.consent.ver || '')} 版）` : c.archived ? '案件已封存' : c.closed ? '案件已結案' : cs === '未簽署' ? '家屬尚未完成資料授權' : '案件尚未確認';
  return `${back}<div class="card hero bad stack"><h1>無法處理這份資料</h1><p>${why}，系統已停止依原授權進行新的資料存取與處理。既有資料依結案與保存規則處理。</p></div>`;
}

/* ---------- 原始文件檢視（原型 docView）：先畫外框，再用短時效網址載入圖片或 PDF 連結 ---------- */
function docView(it, v){
  const f = (v && v.file) || {};
  let body;
  if (f.removed) body = '<p style="font-family:var(--font)">原始檔案已依保存規則刪除，僅保留處理紀錄。</p>';
  else if (v && f.path) body = `<p class="small muted" data-file="${esc(it.dbId)}" data-v="${v.v}" style="font-family:var(--font)">載入檔案中…</p>`;
  else body = v && v.supp ? `<p style="font-family:var(--font)">沒有原始文件：由護理人員補充評估。<br>來源：${esc(v.supp.src)}${v.supp.note ? '（' + esc(v.supp.note) + '）' : ''}<br>${esc(v.supp.at || '')}</p>` : '<p>沒有檔案</p>';
  return `<div class="doc" aria-label="原始文件">${body}<p class="small muted" style="font-family:var(--font);margin-top:10px">檔名：${esc(f.name || '')}　上傳：${esc(v ? v.at : '')}</p></div>`;
}
async function hydrateFiles(root, it){
  for (const el of root.querySelectorAll('[data-file]')){
    try {
      const r = await openFile(el.dataset.file, Number(el.dataset.v));
      if (!r.url){ el.textContent = r.removed ? '原始檔案已依保存規則刪除，僅保留處理紀錄。' : '沒有檔案'; continue; }
      const h = /^image\//.test(r.mime) && !/hei[cf]/.test(r.mime) ? `<img src="${esc(r.url)}" alt="${esc(it.name)}原始文件">`
        : `<p style="font-family:var(--font)">${r.mime === 'application/pdf' ? 'PDF 文件' : '檔案'}：<a href="${esc(r.url)}" target="_blank" rel="noopener">開啟檔案</a>（連結 10 分鐘內有效）</p>`;
      el.outerHTML = h;
    } catch (e){ el.textContent = '無法開啟檔案：' + errText(e); el.classList.add('err'); }
  }
}

/* ========== 家屬：申請流程說明與完整文件清單（原型 familyGuide） ========== */
const famSecondary = () => `<nav class="fam-sec" id="famSecondary" aria-label="其他功能"><a class="fam-sec-btn" href="dashboard.html?view=mycases"><strong>我的申請紀錄</strong><span class="small muted">查看所有申請的狀態與進度</span></a></nav>`;
const stripActions = html => html.replace(/<(button|a)\b[^>]*class="btn[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '');
const FAMILY_NEED = (R, it) => it.key === 'contract' ? ['機構提供，簽約時完成', 'info'] : R.instDoc(it) ? ['機構提供', 'info'] : R.notApplicable(it) ? ['本案不需繳交', 'mute'] : R.needOf(it) === '選填' ? ['選填', 'info'] : R.condPending(it) ? [R.nurseCond(it) ? '待護理確認' : '視情況繳交', 'warn'] : R.nurseCond(it) ? ['本案需要繳交', 'bad'] : ['需要繳交', 'bad'];
const partsText = it => (it.parts || []).filter(p => p.need !== '不適用').map(p => p.name + (p.need === '必備' ? '' : `（${p.need}）`)).join('、');
function lastTouch(R, i){
  const v = R.cur(i), ts = [v && v.at, v && v.idCheck && v.idCheck.at, v && v.dateAt, v && v.nurseAt, i.returned && i.returned.at, i.req && i.req.at, i.needSetAt].filter(Boolean);
  return ts.sort().slice(-1)[0] || '';
}
function familyDocRow(R, i, c){
  const st = R.status(i, c), v = R.cur(i), na = R.notApplicable(i), active = R.activeStages(c).includes(i.stage);
  const [nt, ntone] = FAMILY_NEED(R, i);
  const review = na ? '不需要' : v ? FAMILY_WORD[st] : (R.isNeeded(i) && !active) ? '之後再準備' : '尚未上傳';
  const reason = st === '需補件' && i.returned ? `補件原因：${i.returned.reason}${i.returned.note ? '（' + i.returned.note + '）' : ''}`
    : st === '確認過期' ? `報告日期太早（${slash(R.itemDate(i, v)) || '無法確認'}），請做 ${md(R.needBy(i, c))} 以後的檢查`
    : R.openFormalReq(i, c) ? `機構要求：${i.req.reason}${i.req.note ? '（' + i.req.note + '）' : ''}` : '';
  const nb = R.needBy(i, c), lt = lastTouch(R, i);
  return `<div class="drow ${na ? 'na' : ''}"><div class="t-main"><div class="t-name">${esc(famName(i))}</div>
    <div class="row small">${pill(nt, ntone)}${pill(i.stage === '入住前' ? '入住前（簽約後）' : '評估前', 'mute')}${na ? '' : R.instDoc(i) ? pill('狀態：' + FAMILY_WORD[st], TONE[st]) + (v && i.key === 'contract' && v.provider !== '機構' ? pill(`已收到您上傳的影本（第 ${v.v} 版）`, 'info') : '') : pill('上傳：' + (v ? `已上傳第 ${v.v} 版` : '尚未上傳'), v ? 'info' : 'mute')}${na || !v || R.instDoc(i) ? '' : pill('審核：' + review, TONE[st])}${!v && !na && !R.instDoc(i) && R.isNeeded(i) && !active ? pill('簽約後再準備', 'mute') : ''}</div>
    ${(R.condPending(i) || (R.needOf(i) === '條件式必備' && i.cond)) ? `<div class="t-why">條件：${esc(uiT(i.cond) || '依住民狀況')}${R.condPending(i) ? '。機構確認後會通知您，現在也可以先上傳。' : ''}</div>` : ''}
    ${reason ? `<div class="err">${esc(reason)}</div>` : ''}
    ${na ? '' : `<details class="small"><summary>準備說明</summary><p style="margin:6px 0 0">${esc(uiT(i.why || ''))}</p><p style="margin:4px 0 0">去哪裡拿：${esc(uiT(i.where || '') || '請洽機構')}</p>${i.validDays ? `<p style="margin:4px 0 0">期限：入住前 ${i.validDays} 天內的報告${nb ? `（${slash(nb)} 以後）` : ''}</p>` : ''}${(i.parts || []).length ? `<p style="margin:4px 0 0">應包含：${esc(partsText(i))}。可以一次上傳整份報告，不用分開上傳。</p>` : ''}</details>`}
    ${lt ? `<div class="t-why">最近更新：${esc(lt)}</div>` : ''}</div></div>`;
}
function familyDocList(R, c){
  const items = R.caseItems(c.id), ct = c.contacts || [];
  const cats = Object.keys(CATS).filter(k => k === 'A' || k === 'E' || items.some(i => R.catOf(i) === k));
  const body = k => {
    let h = items.filter(i => R.catOf(i) === k).map(i => familyDocRow(R, i, c)).join('');
    if (k === 'A') h += `<div class="drow"><div class="t-main"><div class="t-name">緊急聯絡人資料</div><div class="row small">${pill('需要填寫', 'bad')}${pill(ct.length ? '已填寫' : '尚未填寫', ct.length ? 'ok' : 'warn')}</div><div class="t-why">${ct.length ? ct.map((x, n) => `${n ? '第二' : '主要'}：${esc(x.name)}（${esc(x.rel)}）<span class="mono">${esc(x.phone)}</span>`).join('<br>') : '住民發生緊急狀況時，機構會依序聯絡。請至少填一位。'}</div></div></div>`;
    if (k === 'E') h = `<div class="drow"><div class="t-main"><div class="t-name">個人資料蒐集、處理及利用同意書（線上簽署）</div><div class="row small">${pill('需要簽署', 'bad')}${pill(R.consentOk(c) ? '已簽署' : R.consentState(c), R.consentOk(c) ? 'ok' : 'warn')}</div><div class="t-why">${c.consent ? `${esc(c.consent.at)} 由${esc(c.consent.signerName || c.consent.signer)}簽署　緊急送醫（選填項目）：${c.consent.emergency ? '同意' : '未同意'}` : ''}</div></div></div>` + h;
    return h;
  };
  const cnt = k => { const its = items.filter(i => R.catOf(i) === k && (R.isNeeded(i) || R.condPending(i))); const extra = k === 'A' || k === 'E' ? 1 : 0; const dn = its.filter(i => R.isDone(i, c)).length + (k === 'A' && ct.length ? 1 : 0) + (k === 'E' && R.consentOk(c) ? 1 : 0); return { need: its.length + extra, done: dn, todo: !R.canProcess(c) ? 0 : items.filter(i => R.catOf(i) === k && R.familyTodo(i, c) && R.activeStages(c).includes(i.stage)).length + (k === 'A' && !ct.length ? 1 : 0) }; };
  return `<div class="card" id="docList"><h2>入住文件準備清單</h2><p class="muted small">依七大類列出入住需要的文件。「需要繳交」請準備；「視情況繳交」由機構依住民狀況確認；「選填」可以不交；${R.laterItems(c).length ? '標示「簽約後再準備」的文件現在不用急著準備。' : c.flowMode === '先簽後審' ? '本案為先簽後審，入住前文件目前就需要準備。' : ''}上傳後要等機構審核，審核通過才算完成。${R.canProcess(c) ? '' : '<strong>機構確認申請、您簽署資料授權同意書後，就可以開始上傳。</strong>'}</p>
    ${cats.map(k => { const n = cnt(k); return `<details class="dcat" ${n.todo ? 'open' : ''}><summary><strong>${k}. ${esc(CATS[k])}</strong><span class="small muted">需要 ${n.need} 項，已完成 ${n.done} 項</span>${n.todo ? pill(`${n.todo} 項待您處理`, 'bad') : n.done === n.need ? pill('已完成', 'ok') : ''}</summary>${body(k)}</details>`; }).join('')}</div>`;
}
/* 尚未申請（或沒選申請）：一般參考清單（示範機構的內建設定） */
function guideDocRef(catalog){
  const GUIDE_NEED = { '必備': '必備', '條件式必備': '條件式必備', '選填': '選填', '不適用': '不適用' }, INST = ['contract', 'fee', 'payReceipt', 'deposit'];
  return `<div class="stack">${Object.keys(CATS).map(k => { const rs = catalog.filter(r => r.cat === k); if (!rs.length && k !== 'A' && k !== 'E') return '';
    return `<details class="dcat"><summary><strong>${k}. ${esc(CATS[k])}</strong><span class="small muted">${rs.length} 項</span></summary>${k === 'E' ? '<div class="drow"><div class="t-main"><div class="t-name">個人資料蒐集、處理及利用同意書（線上簽署）</div><div class="row small">' + pill('必備', 'bad') + pill('一開始', 'mute') + '</div></div></div>' : ''}${rs.map(r => `<div class="drow"><div class="t-main"><div class="t-name">${esc(uiT(r.fam_name || r.name))}</div>
      <div class="row small">${pill(INST.includes(r.key) ? '機構提供' : GUIDE_NEED[r.need] || r.need, r.need === '必備' ? 'bad' : r.need === '選填' ? 'info' : 'warn')}${pill(r.stage === '入住前' ? '入住前（簽約後）' : '評估前', 'mute')}${r.valid_days ? pill(`入住前 ${r.valid_days} 天內`, 'mute') : ''}</div>
      ${r.cond ? `<div class="t-why">條件：${esc(uiT(r.cond))}（由本中心依個案確認是否需要，未確認前不是確定必交）</div>` : ''}
      <div class="t-why">取得方式：${esc(uiT(r.where) || '請洽本中心')}</div><div class="t-why">準備說明：${esc(uiT(r.why || ''))}</div></div></div>`).join('')}${k === 'A' ? '<div class="drow"><div class="t-main"><div class="t-name">緊急聯絡人資料（線上填寫）</div><div class="row small">' + pill('必備', 'bad') + '</div></div></div>' : ''}</details>`; }).join('')}</div>`;
}
async function guidePage({ main, R, params, org }){
  const list = R.myFamilyCases(), sel = list.find(x => x.id === params.get('case')) || null;
  const { data: catalog } = sel ? { data: [] } : await supabase().from('doc_catalog').select('key, cat, name, fam_name, need, cond, stage, valid_days, why, "where", on_demand').eq('on_demand', false).order('sort');
  const hl = sel ? R.habitFamLabel(sel) : null;
  const habitBox = `<div class="card stack" id="guideHabit"><h3 style="margin:0">住民生活與照護習慣卡（必填）</h3><p class="small" style="margin:0">第一階段必要資料，<strong>線上填寫，不需要上傳檔案</strong>。可以分次填寫、先儲存草稿；填好後按「正式提交」，護理師初審完成才算完成。必填欄位：稱呼、慣用語言、聽力狀況、過敏、日常活動協助（不確定可以選「不清楚」或填「無」）。</p>${sel ? `<p class="small" style="margin:0">目前狀態：${pill(hl[0], hl[1])}</p>` : ''}</div>`;
  const pick = list.length ? `<label class="f small" style="max-width:360px">查看哪一筆申請的清單<select id="guideCase"><option value="">一般參考清單（尚未套用個案）</option>${list.map(x => `<option value="${esc(x.id)}" ${sel && sel.id === x.id ? 'selected' : ''}>${esc(x.patient.name)}（${esc(x.no)}）</option>`).join('')}</select></label>` : '';
  const full = `<div class="card stack" id="fullDocList"><h2>完整文件清單與後續準備項目</h2>
    <p class="small muted" style="margin:0">這裡只供查閱：文件要求、狀態、準備方式與所屬階段。<strong>上傳、補件、填寫與提交請到案件首頁的「目前需要處理」</strong>。</p>${pick}
    ${habitBox}
    ${sel ? (R.listOk(sel) ? `<div id="guideCaseList">${stripActions(familyDocList(R, sel))}</div>` : '<p class="notice warn small">這筆申請的文件清單尚未建立完成。</p>') : `<p class="small muted" style="margin:0">${list.length ? '目前顯示一般參考清單；選擇上方的申請可以看該案件實際適用的清單與狀態。' : '您還沒有提出申請，以下是一般參考清單。'}條件式文件由本中心依個案確認是否需要。</p>${guideDocRef(catalog || [])}`}</div>`;
  main.innerHTML = `<div class="narrow">${backLink('dashboard.html', '回到首頁')}<h1>申請流程說明</h1>${famSecondary()}
    <div class="card stack"><h2>一般流程</h2><ol>
      <li><strong>提出入住申請</strong>：填寫預計入住者資料，確認後送出。系統會記錄正式申請時間與申請編號。</li>
      <li><strong>行政確認</strong>：本中心承辦人會打電話確認您的身分及與預計入住者的關係，確認後轉交護理部門。</li>
      <li><strong>簽署個人資料同意書</strong>：同意後本中心才能收下並查看醫療資料。</li>
      <li><strong>上傳文件、提交習慣卡</strong>：依「目前需要處理」上傳文件，並在線上填寫及正式提交「住民生活與照護習慣卡」（必填）。上傳後要等本中心審核，<strong>上傳或提交不等於審核完成</strong>。</li>
      <li><strong>評估與簽約</strong>：依本中心的入住流程，可能先評估再簽約，或先參訪簽約再做入住前確認。</li>
      <li><strong>入住準備</strong>：文件都確認後，照顧團隊會準備入住。</li></ol>
      <p class="small muted">案件首頁只列「目前需要處理」「正在審核」「已完成」與下一階段提醒；七大類完整清單放在下方，只供查閱。後續階段的文件可以先看準備說明，不會算成目前缺件或逾期。</p>
      <p class="small muted">參訪、保證金等安排依本中心規定，請洽承辦人；系統不處理付款。</p></div>${full}${helpLine(org)}</div>`;
  main.querySelector('#guideCase')?.addEventListener('change', e => location.assign(`documents.html?view=list${e.target.value ? '&case=' + e.target.value : ''}`));
}

/* ========== 家屬：上傳（原型 familyUpload） ========== */
/* 可以沿用的已上傳檔案（原型 shareSources）：B 類可沿用體檢報告；D 類可沿用 C、D 類已上傳、非沿用、不是需補件的文件 */
function shareSources(R, c, i){
  const hasFile = x => { const v = R.cur(x); return !!(v && v.file && v.file.path && !v.file.removed); };
  if (R.catOf(i) === 'B'){ const ex = R.caseItems(c.id).find(x => x.key === 'exam'); return ex && ex.id !== i.id && hasFile(ex) ? [ex] : []; }
  if (R.catOf(i) !== 'D') return [];
  return R.caseItems(c.id).filter(x => x.id !== i.id && ['C', 'D'].includes(R.catOf(x)) && hasFile(x) && !R.cur(x).fromItem && R.status(x, c) !== '需補件');
}
const UP_OK = ['未上傳', '確認過期', '需補件'];
function uploadPage({ main, R, c, it: i, org, back }){
  const st = R.status(i, c);
  if (!R.canProcessItem(c, i) || R.notApplicable(i) || !R.listOk(c) || (R.instDoc(i) && i.key !== 'contract')){ location.replace(`application.html?case=${c.id}`); return; }
  const nb = R.needBy(i, c), srcs = shareSources(R, c, i);
  const ret = st === '需補件' && i.returned ? `<div class="notice bad"><strong>機構請您重新上傳：</strong>${esc(i.returned.reason)}${i.returned.note ? `。${esc(i.returned.note)}` : ''}</div>` : '';
  const exp = st === '確認過期' ? `<div class="notice bad">上次的報告日期是 ${slash(R.itemDate(i, R.cur(i))) || '無法確認'}，已超過期限。</div>` : '';
  main.innerHTML = `<div class="narrow">${back}
  <h1>上傳：${esc(famName(i))}</h1>
  ${purpose('拍照或選擇檔案，送出後本中心就會收到，審核通過才算完成。')}
  <div class="stack">${ret}${exp}
  <div class="card stack">
    <div><h3>為什麼需要</h3><p>${esc(uiT(i.why || ''))}</p></div>
    <div><h3>去哪裡拿</h3><p>${esc(uiT(i.where || ''))}</p></div>
    <div><h3>需要繳交嗎</h3><p>${esc(R.familyNeedText(i))}</p></div>
    ${(i.parts || []).length ? `<div class="notice info">體檢報告應包含：${esc(partsText(i))}。<strong>可以一次上傳整份報告</strong>，機構會再核對包含哪些項目。</div>` : ''}
    ${nb ? `<div class="notice warn"><strong>注意期限：</strong>請提供 <strong>${slash(nb)}</strong> 以後的報告（入住前 ${i.validDays} 天內）。</div>` : ''}
  </div>
  ${srcs.length ? `<div class="card stack"><h3>${R.catOf(i) === 'B' ? '體檢報告裡已經有這一項？' : '其他已上傳的文件裡已經有這些資料？'}</h3><p class="small">醫院常把${esc(famName(i))}寫在其他文件裡（例如出院摘要或護理指導單）。如果已上傳的文件已經包含，可以直接使用同一份檔案，不用再拍一次。機構仍會另外核對。</p><div class="row">${srcs.map(x => `<button type="button" class="btn" data-from="${esc(x.dbId)}">${x.key === 'exam' ? '使用已上傳的體檢報告' : `使用「${esc(famName(x))}」`}</button>`).join('')}</div><div class="err" id="ueErr" role="alert"></div></div>` : ''}
  <form class="card stack" id="uploadForm" novalidate>
    <div class="drop">
      <label class="f" for="file" data-req>選擇照片或 PDF<span class="hint">可以直接用手機拍照。照片請拍清楚、整張入鏡。</span></label>
      <input type="file" id="file" name="file" accept="image/*,application/pdf">
      <div id="picked" class="small"></div>
    </div>
    ${i.validDays ? `<label class="f">報告上的檢查日期<span class="hint">填了可以讓機構更快確認，也能先幫您檢查有沒有過期。</span><input type="date" name="date" id="examDate" max="${todayTW()}"></label><div id="dateHint"></div>` : ''}
    <div class="err" id="upErr" role="alert"></div>
    <button type="submit" class="btn primary big" id="upBtn">送出</button>
  </form></div>${helpLine(org)}</div>`;
  const $ = s => main.querySelector(s), setErr = (id, m) => { $(id).textContent = m; };
  const fi = $('#file'), dateIn = $('#examDate');
  /* 選好的檔案與已上傳的位置保留在記憶體：寫入失敗後重試不必重新選檔，也不會重複上傳檔案 */
  let pick = null;
  fi.addEventListener('change', () => { pick = fi.files[0] ? { file: fi.files[0], up: null } : null; $('#picked').textContent = fi.files[0] ? '已選擇：' + fi.files[0].name : ''; setErr('#upErr', ''); });
  dateIn?.addEventListener('change', () => { const h = $('#dateHint'), val = dateIn.value; if (!isDate(val)){ h.innerHTML = ''; return; }
    const diff = d2n(c.plannedAdmit) - d2n(val);
    h.innerHTML = diff > i.validDays ? `<div class="notice warn">這份報告到入住日已經 ${diff} 天，超過 ${i.validDays} 天的規定，入住前需要重新檢查。還是可以先上傳。</div>` : '<div class="notice ok">日期符合規定。</div>'; });
  $('#uploadForm').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('#upBtn'); if (btn.disabled) return;
    const file = pick && pick.file, prob = fileProblem(file);
    if (!UP_OK.includes(st) && !(i.key === 'contract' && ['待簽約', '已登錄簽約', '待登錄簽約'].includes(st))) return setErr('#upErr', '這份文件機構正在確認中，不需要重複上傳');
    if (prob) return setErr('#upErr', prob);
    if (dateIn && dateIn.value && dateIn.value > todayTW()) return setErr('#upErr', '檢查日期不能晚於今天');
    btn.disabled = true; btn.textContent = '上傳中，請稍候…'; setErr('#upErr', '');
    const nextV = (R.cur(i) ? R.cur(i).v : 0) + 1;
    try {
      if (!pick.up || pick.up.v !== nextV) pick.up = { v: nextV, ...(await uploadFile(c.id, i.key, nextV, file)) };
      const { error } = await supabase().rpc('submit_version', { p_doc: i.dbId, p_path: pick.up.path, p_file_name: pick.up.name, p_user_date: dateIn && isDate(dateIn.value) ? dateIn.value : null });
      if (error) throw error;
      invalidateModel(); location.assign(`documents.html?view=uploaded&case=${c.id}&item=${i.dbId}`);
    } catch (err){
      btn.disabled = false; btn.textContent = '送出';
      setErr('#upErr', '上傳失敗：' + errText(err) + '。檔案已保留，請再按一次「送出」。');
    }
  });
  main.querySelectorAll('[data-from]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase().rpc('reuse_file', { p_doc: i.dbId, p_from: b.dataset.from });
    if (error){ b.disabled = false; setErr('#ueErr', '沒有完成：' + errText(error) + '。可以再試一次，或改用下方直接上傳。'); return; }
    invalidateModel(); location.assign(`documents.html?view=uploaded&case=${c.id}&item=${i.dbId}`);
  }));
}
function uploadedPage({ main, c, it: i, org }){
  main.innerHTML = `<div class="narrow"><div class="card hero ok stack"><h1>已上傳「${esc(famName(i))}」，等待本中心審核</h1><p>本中心會盡快審核，審核所需時間依本中心作業安排。<strong>上傳不等於審核完成</strong>；審核期間不用重複上傳，有問題時會在系統通知您。</p><a class="btn primary big" href="application.html?case=${c.id}">回到首頁</a></div>${helpLine(org)}</div>`;
}

/* ========== 行政：收件核對（原型 staffReceipt、staffSignerReceipt） ========== */
/* 出生日期比對結果（原型 birthCmpHtml） */
const birthCmpHtml = (cmp, raw, src) => `<div class="small" style="display:grid;gap:2px;margin-top:4px">${raw ? `<span>原始值：<span class="mono">${esc(raw)}</span>（來源：${esc(src)}）</span>` : ''}${cmp.n && cmp.n.iso ? `<span>正規化：<strong class="mono">${birthSlash(cmp.n.iso)}</strong>（${esc(cmp.note)}）</span>` : `<span class="muted">${esc(cmp.note)}</span>`}<span>比對結果：${pill(cmp.result, BIRTH_TONE[cmp.result])}</span></div>`;
/* 這個版本的 AI 辨識紀錄（日期、出生日期） */
async function ocrRuns(it, v){
  const { data } = await supabase().from('ocr_runs').select('id, mode, run, status, result, error, created_at').eq('document_id', it.dbId).eq('version_v', v.v).order('created_at');
  return data || [];
}
const canOcr = v => !!(v && v.file && v.file.path && !v.file.removed && OCR_TYPES.includes(v.file.type));
async function callOcr(it, v, mode){
  const { data, error } = await supabase().functions.invoke('ocr', { body: { document_id: it.dbId, v: v.v, mode } });
  if (error){ let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch { /* 沿用原訊息 */ } return { ok: false, reason: msg }; }
  return data;
}

function idPendingModal(it, v, c, from){
  modal({ title: '標示身分待確認', ok: '標示', danger: true, body: '<label class="f" data-req>說明哪裡不符<textarea id="pendNote"></textarea></label>', onOk: async host => {
    const n = host.querySelector('#pendNote').value.trim(); if (!n) return '請填寫說明';
    const { error } = await supabase().rpc('mark_id_pending', { p_doc: it.dbId, p_v: v.v, p_note: n });
    if (error) return '標示失敗：' + errText(error) + '。資料沒有變更，可以再試一次。';
    done('已標示身分待確認', afterUrl(c, from)); return '';
  } });
}
/* 收件完成後：狀態改變可能建立了補件（例如確認過期）→ 補寄 Email 通知 */
async function afterReceipt(r, c, msg, from){
  let extra = '';
  if (r && (r.requests || []).length) extra = await syncReqMails(c.id);
  done(msg + (extra ? '。' + extra : ''), afterUrl(c, from));
}

async function signerReceiptPage({ main, R, c, it, back, from }){
  const v = R.cur(it);
  if (!R.canProcessItem(c, it)) return void (main.innerHTML = blocked(R, c, back));
  if (!v) return void (main.innerHTML = `${back}<div class="card"><h1>${esc(it.name)}</h1><p>這份文件尚未上傳，目前沒有可以收件核對的檔案。</p></div>`);
  const ct = (c.contacts || [])[0];
  main.innerHTML = `${back}<h1>收件核對：${esc(c.patient.name)}｜${esc(it.name)}</h1>
  ${purpose('這份是<strong>簽約者（家屬或代理人）</strong>的身分證明，不和住民的資料比對。請確認證件上的人就是簽訂入住契約的人。')}
  <div class="split">${docView(it, v)}
  <form class="card stack" id="signerForm" novalidate>
    <label class="f" data-req>簽約者姓名（照證件填寫）<input type="text" name="signerName" value="${esc(ct && ct.rel !== '本人' ? ct.name : '')}"></label>
    <label class="choice"><input type="checkbox" name="signerOk"><span>已核對：證件上的人就是入住契約的簽約人</span></label>
    <label class="choice"><input type="checkbox" name="content"><span>影本清楚、內容完整</span></label>
    <div class="err" id="sgErr" role="alert"></div>
    <button type="submit" class="btn primary big">確認簽約者身分</button>
    <button type="button" class="btn danger" id="idPending">資料不符，標示身分待確認</button>
  </form></div>`;
  hydrateFiles(main, it);
  const f = main.querySelector('#signerForm'), err = m => { main.querySelector('#sgErr').textContent = m; };
  main.querySelector('#idPending').addEventListener('click', () => idPendingModal(it, v, c, from));
  f.addEventListener('submit', async e => {
    e.preventDefault(); const d = new FormData(f), name = String(d.get('signerName') || '').trim(), btn = f.querySelector('button[type=submit]');
    if (!['待收件', '身分待確認'].includes(R.status(it, c))) return err('這份文件已經核對過了');
    if (!name) return err('請填寫簽約者姓名');
    if (!d.get('signerOk')) return err('請確認證件上的人就是簽約人');
    if (!d.get('content')) return err('請確認影本清楚、內容完整');
    btn.disabled = true;
    const { data, error } = await supabase().rpc('staff_receipt', { p_doc: it.dbId, p_v: v.v, p_how: '簽約者身分核對：' + name, p_detail: {} });
    if (error){ btn.disabled = false; return err('收件核對失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); }
    afterReceipt(data, c, '已確認，文件完成', from);
  });
}

async function receiptPage({ main, R, c, it, back, from }){
  const v = R.cur(it);
  if (!R.canProcessItem(c, it)) return void (main.innerHTML = blocked(R, c, back));
  if (!v) return void (main.innerHTML = `${backLink(`cases.html?case=${c.id}`, '回到案件')}<div class="card"><h1>${esc(it.name)}</h1><p>這份文件尚未上傳，目前沒有可以收件核對的檔案。</p></div>`);
  const prof = idProfile(it), runs = prof.rows.includes('birth') ? await ocrRuns(it, v) : [];
  /* 出生日期的初始值：最近一次 AI 讀取成功的結果（原型 v.birthRead），否則人工輸入 */
  const lastBirth = runs.filter(r => r.mode === 'birth' && r.status === '完成').slice(-1)[0];
  const b0 = lastBirth ? { raw: (lastBirth.result || {}).birth_raw || '', src: 'AI 辨識' } : { raw: '', src: '人工輸入' };
  const cmp0 = birthCompare(c.patient.birth, b0.raw, b0.src, it.name);
  const fromName = v.fromItem ? v.fromItem.name : '';
  main.innerHTML = `${back}<h1>收件核對：${esc(c.patient.name)}｜${esc(it.name)}</h1>
  ${purpose('看左邊的文件，確認這是住民本人的資料。您只需要核對身分，<strong>不用判斷醫療內容</strong>，那是護理師的工作。')}
  ${(it.parts || []).length ? `<div class="notice info" style="margin-bottom:12px">這份體檢報告依機構要求應包含：${esc(partsText(it))}。<strong>包含哪些項目由護理逐項核對</strong>；明顯缺頁時可以先要求補件。</div>` : ''}
  ${v.fromItem ? `<div class="notice info" style="margin-bottom:12px">家屬沿用「${esc(fromName)}」第 ${v.fromItem.v} 版的檔案，請確認其中確實包含${esc(it.name)}。</div>` : ''}
  ${v.idNote ? `<div class="notice warn" style="margin-bottom:12px">先前標示身分待確認：${esc(v.idNote)}</div>` : ''}
  <div class="split">${docView(it, v)}
  <form class="stack" id="receiptForm" novalidate>
    <div class="card"><h2>逐項比對</h2><div class="tbl-wrap"><table><thead><tr><th>欄位</th><th>機構登記的資料</th><th data-req>文件上的資料（逐項比對）</th></tr></thead><tbody>
    ${ID_ROWS.filter(([k]) => prof.rows.includes(k)).map(([k, label]) => `<tr><th scope="row">${label}</th><td class="mono">${esc(c.patient[k])}</td><td><select name="m-${k}" aria-label="${label}比對結果"><option value="">請選擇</option><option value="相符">相符</option><option value="不符">不符</option>${k === 'name' ? '' : '<option value="沒有">文件上沒有</option>'}</select></td></tr>`).join('')}
    ${prof.rows.includes('chart') ? `<tr><th scope="row">病歷號<br><span class="small muted">選填</span></th><td class="mono">${esc(c.patient.chart || '（機構未登記）')}</td><td><input type="text" name="docChart" placeholder="文件上的病歷號" aria-label="文件上的病歷號"><select name="m-chart" aria-label="病歷號比對結果"><option value="">未核對</option>${c.patient.chart ? '<option value="相符">相符</option>' : ''}<option value="不符">不符</option><option value="沒有">文件上沒有</option>${c.patient.chart ? '' : '<option value="記錄">機構未登記，記錄文件上的病歷號</option>'}</select></td></tr>
    <tr><th scope="row">來源機構<br><span class="small muted">選填</span></th><td>${esc(c.hospital || '（未登記）')}</td><td><input type="text" name="docSrc" placeholder="文件上的醫院或診所" aria-label="文件上的來源機構"><select name="m-source" aria-label="來源機構比對結果"><option value="">未核對</option><option value="相符">相符（同一醫院或診所）</option><option value="不符">不符</option><option value="沒有">文件上沒有</option></select></td></tr>` : ''}
    ${prof.rows.includes('birth') ? `<tr><th scope="row">出生日期</th><td class="mono">${birthSlash(c.patient.birth) || '（未登記）'}</td><td>
        <label class="f small">文件上的出生日期<span class="hint">照文件原樣輸入，民國或西元都可以，例：民國 31 年 3 月 15 日</span><input type="text" id="birthRaw" name="birthRaw" value="${esc(b0.raw)}" autocomplete="off"></label>
        <div id="birthCmp">${birthCmpHtml(cmp0, b0.raw, b0.src)}</div>
        ${canOcr(v) ? '<button type="button" class="btn sm" id="birthAiBtn">用 AI 讀取出生日期</button>' : ''}
        <label class="choice small"><input type="checkbox" name="birthNone" id="birthNone"><span>文件上沒有完整出生日期（或只有年齡）</span></label>
        <label class="choice small" id="birthManualBox" ${cmp0.result === '不一致' ? '' : 'hidden'}><input type="checkbox" name="birthManual"><span>已人工對照：文件上的出生日期與登記相同（系統解讀有誤）</span></label></td></tr>` : ''}
    </tbody></table></div><p class="small muted">${esc(prof.note)}系統不會用年齡或其他欄位推算出生日期，資料不足時不能直接確認符合。</p></div>
    <div class="card stack" id="manualBox" hidden><h2>人工核實</h2><p class="small muted">文件缺少身分證字號或完整出生日期，請選擇核實方式（會留在紀錄）。</p>
      ${MANUAL_HOW.map(([val, t]) => `<label class="choice"><input type="radio" name="how" value="${esc(val)}"><span>${esc(t)}</span></label>`).join('')}
      <label class="f">說明（選「其他」時必填）<input type="text" name="howNote" placeholder="例：與先前已核實的出院摘要病歷號相同"></label>
    </div>
    ${!it.medical ? '<label class="choice"><input type="checkbox" name="content"><span>影本清楚、內容完整</span></label>' : ''}
    <div class="err" id="rcErr" role="alert"></div>
    <button type="submit" class="btn primary big">確認是${esc(c.patient.name)}的資料</button>
    <button type="button" class="btn danger" id="idPending">資料不符，標示身分待確認</button>
  </form></div>`;
  hydrateFiles(main, it);
  const f = main.querySelector('#receiptForm'), err = m => { main.querySelector('#rcErr').textContent = m; };
  main.querySelector('#idPending').addEventListener('click', () => idPendingModal(it, v, c, from));
  /* 出生日期：輸入時即時換算與比對（原型 birthInit／_birth） */
  let bsrc = b0.src;
  const raw = f.querySelector('#birthRaw'), none = f.querySelector('#birthNone');
  const birth = () => { if (!raw) return null; const r = none && none.checked ? '' : raw.value.trim(); const src = r === b0.raw && r ? bsrc : r ? '人工輸入' : bsrc;
    const cmp = none && none.checked ? { result: '資料不足', note: '文件上沒有完整出生日期', n: { state: 'empty' } } : birthCompare(c.patient.birth, r, src, it.name);
    return { ...cmp, raw: r, src }; };
  const refresh = () => {
    const b = birth();
    if (b){ f.querySelector('#birthCmp').innerHTML = birthCmpHtml(b, b.raw, b.src); f.querySelector('#birthManualBox').hidden = b.result !== '不一致'; }
    const nid = f.querySelector('[name="m-nid"]');
    f.querySelector('#manualBox').hidden = !((nid && nid.value === '沒有') || (b && b.result === '資料不足'));
  };
  raw?.addEventListener('input', refresh); none?.addEventListener('change', refresh); f.addEventListener('change', refresh); refresh();
  main.querySelector('#birthAiBtn')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = '讀取中…';
    const r = await callOcr(it, v, 'birth');
    b.disabled = false; b.textContent = '用 AI 讀取出生日期';
    if (!r.ok) return toast('AI 讀取失敗：' + (r.reason || r.error || '辨識服務沒有回應') + '。請對照文件人工輸入。');
    raw.value = r.result.birth_raw || ''; b0.raw = raw.value; bsrc = 'AI 辨識'; refresh();
    toast(raw.value ? '已讀取，請對照文件確認' : 'AI 沒有讀到完整出生日期，請人工確認');
  });
  f.addEventListener('submit', async e => {
    e.preventDefault(); const d = new FormData(f), btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    const val = k => d.get('m-' + k) || '', hasNid = prof.rows.includes('nid'), hasBirth = prof.rows.includes('birth'), bc = birth();
    if (!['待收件', '身分待確認'].includes(R.status(it, c))) return err('這份文件已經核對過了');
    if (!val('name') || (hasNid && !val('nid'))) return err('請完成每一項比對');
    if (hasBirth && bc.result === '不一致' && !d.get('birthManual')) return err(`出生日期不一致：登記 ${birthSlash(c.patient.birth)}，文件 ${birthSlash(bc.n.iso)}。請按「資料不符，標示身分待確認」；若確認是系統解讀有誤，請勾選人工對照。`);
    if (hasBirth && bc.result === '待人工確認') return err('出生日期待人工確認：請對照文件輸入出生日期，或勾選「文件上沒有完整出生日期」');
    const rowsV = ['name', 'nid', 'chart', 'source'].filter(k => prof.rows.includes(k)).map(val);
    if (rowsV.includes('不符')) return err('有欄位不符，請按「資料不符，標示身分待確認」');
    if (val('name') !== '相符') return err('姓名必須相符');
    const docChart = String(d.get('docChart') || '').trim(), docSrc = String(d.get('docSrc') || '').trim();
    if (val('chart') === '記錄' && !docChart) return err('請填寫文件上的病歷號');
    const missing = (hasNid && val('nid') === '沒有') || (hasBirth && bc.result === '資料不足');
    let how = prof.rows.length === 1 ? '住民姓名相符（機構自行簽訂或開立的文件）' : '必要欄位全部相符', level = '相符';
    if (missing){
      const h = d.get('how'), note = String(d.get('howNote') || '').trim();
      if (!h) return err('文件缺少身分證字號或完整出生日期，資料不足不能直接確認符合。請選擇人工核實方式。');
      if (h === '已比對病歷號與來源機構' && !(['相符', '記錄'].includes(val('chart')) && (docChart || val('chart') === '相符') && val('source') === '相符')) return err('選「已比對病歷號與來源機構」時，病歷號要相符或記錄文件上的病歷號，來源機構也要相符');
      if (h === '已與同一來源先前已核實的文件比對' && val('source') !== '相符') return err('選「已與同一來源先前已核實的文件比對」時，來源機構要相符');
      if (h === '其他' && !note) return err('選「其他」時請填寫說明');
      how = '人工例外核對：' + h + (note ? '（' + note + '）' : ''); level = '人工核實';
    }
    if (!it.medical && !d.get('content')) return err('請確認影本清楚、內容完整');
    const birthRec = hasBirth ? { raw: bc.raw, src: bc.src, norm: (bc.n && bc.n.iso) || '', reg: c.patient.birth || '', result: bc.result + (bc.result === '不一致' ? '（人工確認相同）' : ''), note: bc.note } : null;
    const rows = {}; prof.rows.filter(k => k !== 'birth').forEach(k => { rows[k] = { reg: k === 'chart' ? c.patient.chart || '' : k === 'source' ? c.hospital || '' : c.patient[k] || '', doc: k === 'chart' ? docChart : k === 'source' ? docSrc : '', result: val(k) || '未核對' }; });
    /* 操作紀錄寫入完整的核對方式（原型：身分確認（方式；出生日期結果；病歷號）） */
    const logHow = how + (birthRec ? `；出生日期${birthRec.result}${birthRec.norm ? '：' + birthRec.norm.replace(/-/g, '/') : ''}` : '') + (docChart ? '；病歷號 ' + docChart : '');
    btn.disabled = true;
    const { data, error } = await supabase().rpc('staff_receipt', { p_doc: it.dbId, p_v: v.v, p_how: logHow, p_detail: { level, rows, birth: birthRec } });
    if (error){ btn.disabled = false; return err('收件核對失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); }
    afterReceipt(data, c, it.medical ? '已確認，文件已交給下一步處理' : '已確認，文件完成', from);
  });
}

/* ========== 行政：核對日期（原型 staffDate、ocrBox） ========== */
function ocrBox(v, runs, mode){
  const mine = runs.filter(r => r.mode === mode), last = mine[mine.length - 1], ok = mine.filter(r => r.status === '完成').slice(-1)[0];
  const okRun = ok ? `第 ${ok.run} 次（${esc(stamp(ok.created_at))}）` : '';
  const lastLine = last ? (last.status === '失敗' ? `<p class="err" role="alert">第 ${esc(last.run)} 次辨識失敗（${esc(stamp(last.created_at))}）：${esc(last.error || '')}。${ok ? `目前畫面上的 AI 內容來自先前${okRun}的辨識，<strong>不是這次的結果</strong>。` : '本次沒有任何辨識結果。'}可以按「重新辨識」再試，或直接依原始文件人工${mode === 'date' ? '確認日期' : '輸入'}。</p>`
    : `<p class="small muted">第 ${esc(last.run)} 次辨識：${esc(stamp(last.created_at))}　${esc(last.status)}${last.result && last.result.summary ? '：' + esc(last.result.summary) : ''}${runs.length ? `　（第 ${v.v} 版共辨識 ${runs.length} 次）` : ''}</p>`) : '';
  if (!canOcr(v)) return `<div class="card small muted">${v.file && v.file.path && !v.file.removed ? '這份文件的格式無法自動辨識' : '這個版本沒有可以辨識的檔案'}，請依原始文件人工${mode === 'date' ? '確認日期' : '輸入'}。</div>`;
  const has = mode === 'date' ? !!v.aiDate : !!ok;
  return `<div class="card stack"><div class="row between"><strong>${mode === 'date' ? '用 AI 讀取文件日期' : has ? '已有 AI 辨識內容' : '用 AI 辨識文件內容'}</strong><button type="button" class="btn sm ${has ? '' : 'primary'}" id="ocrBtn">${has || (last && last.status === '失敗') ? '重新辨識' : '自動辨識'}</button></div><p class="small muted">會把這份文件交給 Claude（Anthropic 的 AI 服務）辨識。辨識結果只是建議，${mode === 'date' ? '日期仍須由您對照文件確認' : '每一欄都要對照原始文件確認'}；辨識失敗時請直接人工處理。</p>${lastLine}<div class="err" id="ocrErr" role="alert"></div></div>`;
}
const stamp = iso => { if (!iso) return ''; const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`; };

async function datePage({ main, R, c, it, back, from }){
  const v = R.cur(it);
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c, back));
  if (!v || !it.validDays) return void (main.innerHTML = `${back}<div class="card"><h1>${esc(it.name)}</h1><p>這份文件目前沒有需要核對的日期。</p></div>`);
  const nb = R.needBy(it, c), pd = R.prelimDate(it, v), ps = R.prelimSrc(it, v), runs = await ocrRuns(it, v);
  main.innerHTML = `${back}<h1>核對日期：${esc(c.patient.name)}｜${esc(it.name)}</h1>
  ${purpose('請只核對「文件上印的檢查日期」。系統計算的結果只是初步判斷，<strong>一定要由您確認</strong>。確認後若超過期限，系統會通知家屬重新檢查；若在期限內，會交給護理師核對內容。')}
  <div class="split">${docView(it, v)}
  <div class="card stack">
    <p>規定：預計入住日 ${slash(c.plannedAdmit)} 前 <strong>${it.validDays} 天內</strong>，也就是 <strong>${slash(nb)} 以後</strong>的報告。</p>
    <p>${v.userDate ? `家屬填寫的日期：<strong class="mono">${slash(v.userDate)}</strong>` : '家屬沒有填寫日期。'}${R.aiDate(it, v) ? `<br>AI 辨識的日期：<strong class="mono">${slash(R.aiDate(it, v))}</strong>` : ''}</p>
    <p>系統初步判斷：${isDate(pd) ? P(R.inValid(it, c, pd) ? '初步符合' : '疑似過期') + `（依${esc(ps)}的日期）` : pill('無日期', 'warn')}</p>
    ${ocrBox(v, runs, 'date')}
    <label class="f" data-req>文件上的日期<span class="hint">請看左邊文件上印的日期，不要直接沿用系統或家屬的日期</span><input type="date" id="dateVal" value="${esc(v.dateConfirmed || '')}"></label>
    <div class="err" id="dateErr" role="alert"></div>
    <button type="button" class="btn primary big" id="dateConfirm">確認日期</button>
    <p class="small muted">家屬只會收到「有待補件項目」的系統通知與白話說明，不含其他醫療內容。</p>
  </div></div>`;
  hydrateFiles(main, it);
  const err = m => { main.querySelector('#dateErr').textContent = m; };
  main.querySelector('#ocrBtn')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = '辨識中，約 10–30 秒…'; main.querySelector('#ocrErr').textContent = '';
    const r = await callOcr(it, v, 'date');
    if (!r.ok && !r.run){ b.disabled = false; b.textContent = '重新辨識'; main.querySelector('#ocrErr').textContent = '辨識沒有執行：' + (r.reason || r.error || ''); return; }
    done(r.ok ? '已讀取日期，請對照文件後確認' : '辨識失敗：' + r.reason);
  });
  main.querySelector('#dateConfirm').addEventListener('click', async e => {
    const b = e.currentTarget, val = main.querySelector('#dateVal').value;
    if (!isDate(val)) return err('請輸入文件上的日期');
    if (val > todayTW()) return err('日期不能晚於今天');
    if (!['初步符合', '疑似過期'].includes(R.status(it, c))) return err('這份文件目前不在日期確認步驟（' + R.status(it, c) + '）');
    b.disabled = true;
    const { data, error } = await supabase().rpc('confirm_doc_date', { p_doc: it.dbId, p_v: v.v, p_date: val });
    if (error){ b.disabled = false; return err('確認日期失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); }
    const msg = data.status === '確認過期' ? '已確認過期，系統已通知家屬' : it.medical ? '日期在期限內，已交給護理師核對內容' : '日期在期限內';
    afterReceipt(data, c, msg, from);
  });
}

/* ========== 行政：補件追蹤（原型 staffFollowup） ========== */
function followupPage({ main, R }){
  const rows = R.followupRows();
  main.innerHTML = `${backLink('dashboard.html', '回到工作清單')}<h1>補件追蹤</h1>
  ${purpose(`列出所有等家屬上傳或補件的文件。補件期限預設為通知後 ${R.reqDays()} 天（可在機構設定修改）。逾期的排在最上面；家屬上傳後會自動從清單移除。`)}
  <div class="card tbl-wrap"><table><thead><tr><th>住民</th><th>文件</th><th>原因</th><th>期限</th><th>已提醒</th><th></th></tr></thead><tbody id="fuRows">
  ${rows.map(({ c, i, st, due, od, fam }) => `<tr><td>${esc(c.patient.name)}<br><span class="small muted">${esc(R.accName(c.familyId))} <span class="mono">${esc((R.acct(c.familyId) || {}).phone || '')}</span></span></td><td>${esc(i.name)}<br>${pill(R.formalReq(i) ? '正式補件' : '首次繳交', R.formalReq(i) ? 'warn' : 'mute')}</td><td>${fam ? P(st) : pill('已補傳，審核中', 'info')}<br><span class="small">${st === '需補件' && i.returned ? esc(i.returned.reason) + (i.returned.note ? '：' + esc(i.returned.note) : '') : st === '確認過期' ? '日期超過期限' : fam ? '尚未上傳' : `目前：${esc(st)}（確認符合後才關閉請求）`}</span>${R.formalReq(i) ? `<br><span class="small muted">來源：${esc(i.req.source || '系統')}</span>` : ''}</td><td>${due ? `${slash(due)}${od ? '<br>' + pill('逾期', 'bad') : ''}` : '<span class="muted">未設定</span>'}</td><td class="small">${i.remind ? `${i.remind.n} 次<br>${esc(i.remind.at)}` : '—'}</td><td>${fam ? `<button type="button" class="btn sm" data-remind="${esc(i.dbId)}">再次提醒</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">目前沒有等待補件的文件。</td></tr>'}
  </tbody></table></div>`;
  main.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error } = await supabase().rpc('remind_document', { p_doc: b.dataset.remind });
    if (error){ b.disabled = false; toast('提醒失敗：' + errText(error)); return; }
    done('已通知家屬');
  }));
}

/* ========== 行政、承辦護理：看文件（原型 docPage；只能查看） ========== */
async function docPage({ main, R, c, it, me, params, back }){
  if (me.role === 'nurse' && c.nurseId !== me.id) return void (main.innerHTML = '<div class="card">您不是這位住民的負責護理師，無法查看文件。</div>');
  if (me.role === 'nurse' && !R.nurseCanSee(it)) return void (main.innerHTML = `${back}<div class="card">這份文件（${esc(it.name)}）屬於身分、契約或費用資料，由行政處理，護理端不顯示。</div>`);
  if (R.consentState(c) === '已撤回') return void (main.innerHTML = blocked(R, c, back));
  const vs = it.versions || [], sel = vs.find(v => String(v.v) === params.get('v')) || R.cur(it);
  if (!sel) return void (main.innerHTML = `${back}<div class="card"><h1>${esc(it.name)}</h1><p>這份文件尚未上傳。</p></div>`);
  const fields = sel.fields ? fieldDefs(it).map(d => [d.label, sel.fields[d.k]]).filter(([, x]) => x != null && x !== '') : [];
  if (sel.supp) fields.unshift(['資料來源', `護理補充評估：${sel.supp.src}${sel.supp.note ? '（' + sel.supp.note + '）' : ''}`]);
  const ck = R.checks(it, c), ic = sel.idCheck;
  const vUrl = n => `documents.html?view=doc&case=${c.id}&item=${it.dbId}&v=${n}${params.get('from') ? '&from=' + params.get('from') : ''}`;
  main.innerHTML = `${back}<h1>${esc(c.patient.name)}｜${esc(it.name)}</h1>
  <p class="lead">${P(R.status(it, c))}　只能查看，不能修改。</p>${me.role === 'staff' && R.nurseCanSee(it) ? '<p class="notice info small" id="staffMedNote">行政可以查看醫療文件原始內容，用來核對身分、日期與效期；醫療內容（診斷、用藥、檢驗判讀、照護需求）由承辦護理師確認，行政不能修改或確認。</p>' : ''}
  ${ck ? `<p><span class="small muted">身分：${ck.idOk ? '已核對' : '待核對'}${it.validDays ? `｜系統：${esc(ck.sys)}` : ''}｜行政：${esc(ck.admin)}${it.medical ? `｜護理：${esc(ck.nurse)}` : ''}</span></p>` : ''}
  ${vs.length > 1 ? `<div class="seg" role="group" aria-label="文件版本" style="margin-bottom:12px">${vs.map(v => `<a class="btn sm" href="${vUrl(v.v)}" aria-pressed="${sel.v === v.v}" ${sel.v === v.v ? 'aria-current="true"' : ''}>第 ${v.v} 版</a>`).join('')}</div>` : ''}
  <div class="split">${docView(it, sel)}
  <div class="stack">
    ${fields.length ? `<div class="card"><h2>確認後的內容</h2><table><tbody>${fields.map(([k, x]) => `<tr><th scope="row">${esc(k)}</th><td style="white-space:pre-line">${esc(x)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card muted">這個版本${sel.nurseOk ? '' : '尚未完成'}護理核對。</div>`}
    ${ic ? `<div class="card small">收件核對：${esc(R.accName(ic.by))}，${esc(ic.at)}（${esc(ic.how)}）${ic.rows ? '<br>' + Object.entries(ic.rows).map(([k, x]) => `${esc(ID_LABEL[k])}：${esc(x.result)}${x.doc ? '（文件：' + esc(x.doc) + '）' : ''}`).join('　') : ''}${ic.birth ? `<br>出生日期：${pill(ic.birth.result, BIRTH_TONE[String(ic.birth.result).replace(/（.*/, '')])}　原始值「${esc(ic.birth.raw || '—')}」（${esc(ic.birth.src)}）→ ${esc(ic.birth.norm ? ic.birth.norm.replace(/-/g, '/') : '無法正規化')}；登記 ${esc(ic.birth.reg ? ic.birth.reg.replace(/-/g, '/') : '—')}` : ''}</div>` : ''}
  </div></div>`;
  hydrateFiles(main, it);
}

/* ========== 行政：要求家屬補件（原型 staff-request 對話框） ========== */
function requestPage({ main, R, c, back }){
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c, back));
  const list = R.caseItems(c.id).filter(i => (!R.notApplicable(i) || R.nurseCond(i)) && R.activeStages(c).includes(i.stage));
  /* 管路、傷口、吞嚥：護理尚待確認或判定不需要時不能勾選，需先請護理重新判斷 */
  const locked = i => R.nurseCond(i) && !R.isNeeded(i);
  const needPill = i => pill(R.needText(i), R.notApplicable(i) ? 'mute' : R.condPending(i) ? 'warn' : NEED_TONE[R.needOf(i)]);
  main.innerHTML = `${back}<h1>要求家屬補件：${esc(c.patient.name)}</h1>
  <form class="card stack" id="reqForm" novalidate><fieldset><legend>要補哪些文件？</legend>${list.map(i => locked(i) ? `<label class="choice" style="opacity:.75"><input type="checkbox" name="srItem" value="${esc(i.dbId)}" disabled><span>${esc(i.name)}　${needPill(i)}<br><span class="small">是否需要由負責護理師判斷，不能直接要求補件。請在案件頁按「請護理重新判斷」。</span></span></label>` : `<label class="choice"><input type="checkbox" name="srItem" value="${esc(i.dbId)}"><span>${esc(i.name)}　${P(R.status(i, c))}</span></label>`).join('')}</fieldset>
    <label class="f">其他資料（不在清單上時填寫）<input type="text" id="srOther"></label>
    <label class="f">其他資料由誰確認<select id="srMed"><option value="">行政確認（一般文件）</option><option value="1">護理核對（醫療文件）</option></select></label>
    <label class="f">原因<select id="srReason"><option>文件不完整或缺頁</option><option>影本不清楚</option><option>資料與申請不符</option><option>需要補充其他文件</option></select></label>
    <label class="f">給家屬的說明（選填，請用白話）<textarea id="srNote"></textarea></label>
    <div class="err" id="srErr" role="alert"></div>
    <div class="row"><button type="submit" class="btn primary">送出補件要求</button><a class="btn" href="cases.html?case=${c.id}">取消</a></div></form>`;
  const f = main.querySelector('#reqForm'), err = m => { main.querySelector('#srErr').textContent = m; };
  f.addEventListener('submit', async e => {
    e.preventDefault(); const btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    const ids = [...f.querySelectorAll('input[name=srItem]:checked')].map(x => x.value), other = f.querySelector('#srOther').value.trim();
    if (!ids.length && !other) return err('請至少選一份文件，或填寫其他資料');
    btn.disabled = true;
    const { data, error } = await supabase().rpc('request_documents', { p_case: c.id, p_docs: ids, p_other: other, p_other_medical: !!f.querySelector('#srMed').value, p_reason: f.querySelector('#srReason').value, p_note: f.querySelector('#srNote').value.trim() });
    if (error){ btn.disabled = false; return err('補件要求失敗：' + errText(error) + '。沒有送出任何補件要求，可以再試一次。'); }
    const extra = (data.requests || []).length ? await syncReqMails(c.id) : '';
    done('已送出補件要求' + (extra ? '。' + extra : ''), `cases.html?case=${c.id}`);
  });
}

/* ========== 行政：新增其他指定文件（原型 doc-add 對話框） ========== */
function addPage({ main, R, c, back }){
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c, back));
  main.innerHTML = `${back}<h1>新增其他指定文件：${esc(c.patient.name)}</h1>
  <form class="card stack" id="addForm" novalidate>
    <label class="f" data-req>文件名稱<input type="text" id="daName" placeholder="例：疫苗接種紀錄"></label>
    <div class="grid2"><label class="f">類別<select id="daCat">${Object.keys(CATS).map(k => `<option value="${k}" ${k === 'G' ? 'selected' : ''}>${k}. ${esc(CATS[k])}</option>`).join('')}</select></label>
    <label class="f">是否需要繳交<select id="daNeed"><option value="必備">需要繳交</option><option value="選填">選填</option></select></label></div>
    <div class="grid2"><label class="f">由誰核對<select id="daMed"><option value="">行政（一般文件）</option><option value="1">護理（醫療文件）</option></select></label>
    <label class="f">什麼時候要交<select id="daStage"><option>評估前</option><option>入住前</option></select></label></div>
    <label class="f" data-req>為什麼需要（給家屬看）<input type="text" id="daWhy"></label>
    <label class="f">去哪裡拿（給家屬看）<input type="text" id="daWhere"></label>
    <div class="err" id="daErr" role="alert"></div>
    <div class="row"><button type="submit" class="btn primary">新增</button><a class="btn" href="cases.html?case=${c.id}">取消</a></div></form>`;
  const f = main.querySelector('#addForm'), v = s => f.querySelector(s).value.trim(), err = m => { main.querySelector('#daErr').textContent = m; };
  f.addEventListener('submit', async e => {
    e.preventDefault(); const btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    if (!v('#daName')) return err('請填寫文件名稱');
    if (!v('#daWhy')) return err('請填寫為什麼需要，家屬才知道要準備什麼');
    btn.disabled = true;
    const { error } = await supabase().rpc('add_case_document', { p_case: c.id, p_name: v('#daName'), p_cat: v('#daCat'), p_need: v('#daNeed'), p_medical: !!v('#daMed'), p_stage: v('#daStage'), p_why: v('#daWhy'), p_where: v('#daWhere') });
    if (error){ btn.disabled = false; return err('新增失敗：' + errText(error) + '。資料沒有變更，可以再試一次。'); }
    done('已新增文件', `cases.html?case=${c.id}`);
  });
}

/* ========== 行政：上傳／登錄機構提供的文件（原型 inst-up 對話框） ========== */
function instPage({ main, R, c, it, back }){
  if (!it || !R.instDoc(it)) return void (main.innerHTML = `${back}<div class="card">只有機構提供的文件可以在這裡上傳。</div>`);
  if (!R.canProcess(c)) return void (main.innerHTML = blocked(R, c, back));
  main.innerHTML = `${back}<h1>上傳／登錄：${esc(it.name)}</h1>
  <form class="card stack" id="instForm" novalidate>${it.key === 'contract' ? `<p class="small notice warn">上傳契約檔案不代表完成簽約。簽約結果與日期請在案件頁按「家屬已簽約」記錄。${c.signedAt ? '（已於 ' + esc(c.signedAt) + ' 記錄簽約）' : '（目前尚未記錄簽約）'}</p>` : '<p class="small muted">由機構提供或開立，家屬可以看到狀態，不需要自己上傳。</p>'}
    <label class="f" data-req>檔案（照片或 PDF）<input type="file" id="ipFile" accept="image/*,application/pdf"></label>
    <label class="f">說明（選填）<input type="text" id="ipNote" placeholder="${it.key === 'payReceipt' || it.key === 'deposit' ? '例：2026/11/20 收款，收據號碼 R-001' : '例：雙方簽署版本'}"></label>
    <div class="err" id="ipErr" role="alert"></div>
    <div class="row"><button type="submit" class="btn primary">上傳</button><a class="btn" href="cases.html?case=${c.id}">取消</a></div></form>`;
  const f = main.querySelector('#instForm'), err = m => { main.querySelector('#ipErr').textContent = m; };
  let up = null;
  f.querySelector('#ipFile').addEventListener('change', () => { up = null; });
  f.addEventListener('submit', async e => {
    e.preventDefault(); const btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    const file = f.querySelector('#ipFile').files[0], prob = fileProblem(file);
    if (prob) return err(prob === '請先選擇照片或 PDF' ? '請選擇檔案' : prob);
    btn.disabled = true; err('上傳中…');
    const nextV = (R.cur(it) ? R.cur(it).v : 0) + 1;
    try {
      if (!up || up.v !== nextV) up = { v: nextV, ...(await uploadFile(c.id, it.key, nextV, file)) };
      const { error } = await supabase().rpc('submit_inst_version', { p_doc: it.dbId, p_path: up.path, p_file_name: up.name, p_note: f.querySelector('#ipNote').value.trim() });
      if (error) throw error;
      done('已上傳', `cases.html?case=${c.id}`);
    } catch (ex){ btn.disabled = false; err('上傳失敗：' + errText(ex) + '。可以再試一次。'); }
  });
}

/* ========== 補件 Email 通知（原型 reqMailCard；案件頁也嵌入同一個元件） ========== */
function mailPage({ main, R, D, c, me, back }){
  const card = reqMailCard(R, D, c, me);
  main.innerHTML = `${back}<h1>補件 Email 通知：${esc(c.patient.name)}</h1>${card || '<div class="card"><p class="muted">這個案件目前沒有補件通知。</p></div>'}`;
  bindReqMailCard(main, c);
}
