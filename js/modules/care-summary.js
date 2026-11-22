/* care-summary.html：照顧摘要卡（HANDOFF 6.1、6.2、10.8；原型第 (18) 版 nurseCard（cardForm）、card-revise／discard／stop／resume、careCard）。
 * 畫面與文字沿用原型。
 *
 * 網址：
 *   護理  care-summary.html?case=<id>    審核並開放（第一次或修訂草稿）；已開放後：狀態、修訂內容、停用、重新開放、歷史版本
 *   照服員 care-summary.html?case=<id>   看摘要卡（只能查看；欄位標題可切換中文、Bahasa Indonesia、Tiếng Việt）
 *         照服員的住民清單在 dashboard.html（階段 3）
 *   from=home：從工作清單進來
 *
 * 資料：
 *   護理：get_case_models（判斷規則）＋ case_cards（草稿與歷史版本的完整內容）；寫入走 RPC（migrations/…000031_care_cards.sql）。
 *   照服員：Edge Function care-card——照服員讀不到案件其他資料，伺服器端用同一份規則算出「依據已變更」的欄位，只回傳摘要卡。
 * 摘要卡內容由 rules/card.js（原型 cardFromData、buildCard）產生；依據快照由 rules/core.js cardBasis 產生，
 * 之後依據有實質變更時（cardChanged），照服員畫面受影響欄位改顯示「請問護理站」。 */
import { bootPage } from '../page.js';
import { supabase } from '../api/supabase.js';
import { loadModel, invalidateModel, toStamp } from './services/model.js';
import { esc, pill, toast, modal, purpose, errText, setFlash } from '../ui.js';
import { PHASE_TONE, slash } from './rules/core.js';
import { CARD_A, CARD_B, SRC_TAG, LANG, cardRules } from './rules/card.js';

const backLink = (href, text) => `<a class="back" href="${href}">← ${esc(text)}</a>`;
const srcTag = k => `<span class="src ${SRC_TAG[k][1]}">${SRC_TAG[k][0]}</span>`;
const clone = x => JSON.parse(JSON.stringify(x));
const done = (msg, url) => { invalidateModel(); if (msg) setFlash(msg); if (url) location.assign(url); else location.reload(); };
const HR_TONE = { '尚未提交': 'warn', '審核完成': 'ok', '待審核': 'warn', '有疑義／待確認': 'bad', '資料已變更，需重新確認': 'warn', '尚未填寫': 'mute' };
const CARD_FIELDS = CARD_A.concat(CARD_B);

bootPage('care-summary', async ctx => {
  const { me, params, main } = ctx;
  const caseId = params.get('case');
  if (!caseId){ location.replace('dashboard.html'); return; }
  if (me.role === 'care') return careCard(ctx, caseId);
  if (me.role !== 'nurse'){ main.innerHTML = '<div class="auth card stack"><h1>沒有權限</h1><a class="btn primary" href="dashboard.html">回到首頁</a></div>'; return; }
  const model = await loadModel(me, { caseId });
  const c = model.D.cases[caseId];
  if (!c || c.nurseId !== me.id){ main.innerHTML = '<div class="card stack"><h1>找不到這位住民</h1><p>您不是這位住民的負責護理師，或資料已不存在。</p><a class="btn primary" href="assessment.html">回到負責住民</a></div>'; return; }
  const { data: cards, error } = await supabase().rpc('case_cards', { p_case: c.id });
  if (error) throw error;
  return nursePage({ ...ctx, D: model.D, R: model.R, M: model.me, c, cards: cards || [] });
});

/* ========== 護理：審核並開放（原型 nurseCard、cardForm）、管理（原型 nurseResident 的摘要卡區塊） ========== */
function nursePage(x){
  const { main, R, c, cards, params } = x;
  const fromHome = params.get('from') === 'home';
  const back = fromHome ? backLink('dashboard.html', '回到工作清單') : backLink(`assessment.html?case=${c.id}`, '回到住民資料');
  const p = R.phase(c), CR = cardRules(R);
  const draft = cards.find(k => k.status === '草稿'), live = cards.filter(k => ['已開放', '已停用'].includes(k.status)).slice(-1)[0];
  const cardAllowed = R.canProcess(c) && R.contractSigned(c) && R.assessPassed(c) && R.docsReady(c) && !R.dxPending(c) && R.habitGate(c);
  const reviewing = !!draft || (!live && p === '摘要卡審核中');
  if (reviewing && R.dxPending(c)) return void (main.innerHTML = `${back}<div class="card stack"><h1>診斷清單同步未完成，暫時不能審核摘要卡</h1><p>病摘的逐筆診斷已核對，但個案診斷清單尚未同步。同步完成前，摘要卡不會使用這些診斷。</p><p><a class="btn primary" href="assessment.html?case=${c.id}#sec-dx">前往住民資料重試同步</a></p></div>`);
  if (reviewing && !R.habitGate(c)) return void (main.innerHTML = `${back}<div class="card stack" id="cardHabitBlock"><h1>${(c.habitReview && c.habitReview.done) ? '生活與照護習慣卡最新提交版本尚未確認' : '生活與照護習慣卡尚未完成必要初審'}</h1><p>習慣卡是第一階段必要資料。目前狀態：${pill(R.habitState(c), HR_TONE[R.habitState(c)])}。請先完成初審，再審核照顧摘要卡。</p><p><a class="btn primary" href="assessment.html?case=${c.id}">前往住民資料完成初審</a></p></div>`);
  if (reviewing && cardAllowed) return reviewForm(x, back, CR, draft, live);
  if (live) return managePage(x, back, CR, live);
  main.innerHTML = `${back}<div class="card stack"><h1>目前不能審核摘要卡</h1><p>開放條件：資料授權有效、已簽約、評估通過，且必要文件全部確認符合。目前狀態：${pill(p, PHASE_TONE[p])}</p></div>`;
}

function reviewForm({ main, R, D, c }, back, CR, draft, live){
  /* 草稿：修訂中的新版本；第一次：依已確認資料產生（原型 buildCard，開放時才寫入資料庫） */
  const card = draft ? Object.assign({ caregivers: [], hints: [], risk: '' }, draft.content, { v: draft.v, caregivers: draft.caregivers || [] }) : CR.buildCard(c);
  card.hints = card.hints || [];
  const opts = CR.hintOptions(c).concat(card.hints.filter(h => !CR.hintOptions(c).includes(h)));
  const carers = Object.values(D.accounts).filter(a => a.role === 'care' && a.status === '啟用');
  const hs = R.habitState(c), hd = (c.habitReview || {}).done;
  main.innerHTML = `${back}<h1>${draft ? `修訂照顧摘要卡（第 ${card.v} 版）` : '審核照顧摘要卡'}：${esc(c.patient.name)}</h1>${draft ? `<div class="notice info" style="margin-bottom:12px">開放後，第 ${live ? live.v : ''} 版會標示為「已取代」並保留在歷史紀錄。<button type="button" class="btn sm" id="cardDiscard">放棄這次修訂</button></div>` : ''}
  ${purpose('系統已用確認過的資料產生草稿。請補充或修改，選好要給照服員看的用藥安全提示，再開放給照服員。<strong>摘要卡不能取代醫囑或給藥紀錄。</strong>')}
  <form class="grid2" id="cardForm" novalidate>
    <div class="stack">
      <div class="card stack"><h2>區塊 A：健康與照護重點</h2><p class="small muted">由護理確認過的文件內容與評估帶入。未確認的 AI 辨識內容不會出現在這裡。</p>
        ${CARD_A.map(([k, label, src]) => `<label class="f"><span>${label} ${srcTag(src)}${!card[k] ? ' ' + pill('待確認', 'warn') : ''}</span><textarea name="${k}" rows="2">${esc(card[k] || '')}</textarea></label>`).join('')}</div>
      <div class="card stack"><h2>區塊 B：生活與個人偏好</h2>${hs === '審核完成' ? `<div class="notice ok small" id="cardHabitNote">已沿用審核完成的習慣卡（家屬第 ${hd.rev} 次修改，${esc(R.accName(hd.by))} ${esc(hd.at)} 審核完成），不需要重新審核習慣卡。</div>` : hs === '尚未填寫' ? '' : `<div class="notice warn small" id="cardHabitNote">習慣卡目前為「${esc(hs)}」，以下內容仍是家屬提供、尚未完成初審。不影響開放摘要卡，但請留意。</div>`}<p class="small muted">來自家屬填寫並正式提交的「生活與照護習慣卡」${(R.habitSub(c) || {}).at ? `（最後提交 ${esc(R.habitSub(c).at)}）` : ''}。照服員畫面會標示「家屬提供之生活資訊」。可以精簡文字，但不要把醫療判斷寫在這裡。</p>
        ${CARD_B.map(([k, label]) => `<label class="f"><span>${label} ${srcTag('fam')}</span><textarea name="${k}" rows="2">${esc(card[k] || (k === 'famNote' && card.habit ? card.habit : ''))}</textarea></label>`).join('')}</div></div>
    <div class="stack">
      ${(card.pending || []).length ? `<div class="card stack" style="border-color:var(--bad)"><h2>資料差異（待確認）</h2><p class="small">家屬提供的內容和已確認資料不一致。<strong>已確認資料不會被覆蓋</strong>。請和家屬或醫院確認；確認前建議在摘要卡顯示為待確認資訊。</p>
        ${card.pending.map((pd, n) => `<div class="notice warn small"><strong>${esc(pd.label)}</strong>：已確認「${esc(pd.conf)}」；家屬提供「${esc(pd.fam)}」<label class="choice" style="margin-top:6px"><input type="checkbox" name="pend-${n}" ${pd.show !== false ? 'checked' : ''}><span>在摘要卡顯示為「待確認資訊」</span></label></div>`).join('')}</div>` : ''}
      <div class="card stack"><h2>給照服員看的用藥安全提示</h2><p class="small muted">照服員看不到完整用藥清單和劑量，只會看到您勾選或填寫的提示。</p>
        ${opts.map(h => `<label class="choice"><input type="checkbox" name="hint" value="${esc(h)}" ${card.hints.includes(h) ? 'checked' : ''}><span>${esc(h)}</span></label>`).join('') || '<p class="small muted">依確認的用藥，沒有建議的提示。</p>'}
        <label class="f">其他提示（選填）<input type="text" name="hintExtra"></label></div>
      <fieldset class="card stack" data-req><legend style="font-weight:700;font-size:1.1rem">開放給哪些照服員（至少一位）</legend>
        ${carers.map(n => `<label class="choice"><input type="checkbox" name="cg" value="${esc(n.id)}" ${(card.caregivers || []).includes(n.id) ? 'checked' : ''}><span>${esc(n.name)}</span></label>`).join('') || '<p class="small muted">目前沒有啟用中的照服員帳號。</p>'}
      <div class="err" id="cardErr" role="alert"></div>
      <button type="submit" class="btn primary big">${draft ? '開放新版本給照服員' : '確認並開放給照服員'}</button>
    </fieldset></div>
  </form>`;
  const f = main.querySelector('#cardForm'), err = m => { main.querySelector('#cardErr').textContent = m; };
  main.querySelector('#cardDiscard')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    const { error } = await supabase().rpc('discard_care_card', { p_case: c.id, p_v: draft.v });
    if (error){ e.currentTarget.disabled = false; return toast('放棄草稿失敗：' + errText(error)); }
    done('已放棄這次修訂', `assessment.html?case=${c.id}`);
  });
  f.addEventListener('submit', async e => {
    e.preventDefault(); const d = new FormData(f), btn = f.querySelector('button[type=submit]'); if (btn.disabled) return;
    const out = clone(card); CARD_FIELDS.forEach(([k]) => { out[k] = String(d.get(k) || '').trim(); });
    out.layout = 2; out.pending = (card.pending || []).map((pd, n) => Object.assign({}, pd, { show: !!d.get('pend-' + n) })); delete out.habit;
    out.hints = d.getAll('hint'); const ex = String(d.get('hintExtra') || '').trim(); if (ex) out.hints.push(ex);
    const caregivers = d.getAll('cg');
    if (!caregivers.length) return err('請至少選一位照服員');
    for (const k of ['status', 'v', 'caregivers', 'by', 'at', 'basis', 'why']) delete out[k];
    out.habitReviewRef = { state: R.habitState(c), rev: ((c.habitReview || {}).done || {}).rev || null };
    btn.disabled = true;
    const { error } = await supabase().rpc('open_care_card', { p_case: c.id, p_draft_v: draft ? draft.v : null, p_content: out, p_basis: R.cardBasis(c), p_caregivers: caregivers });
    if (error){ btn.disabled = false; return err('開放失敗：' + errText(error) + '。您填的內容還在，請再試一次。'); }
    done('已開放給照服員', 'dashboard.html');
  });
}

function managePage({ main, R, c, cards }, back, CR, live){
  const ch = R.cardChanged(c), hist = cards.filter(k => k.status === '已取代');
  const names = ids => (ids || []).map(id => R.accName(id)).join('、') || '—';
  main.innerHTML = `${back}<h1>照顧摘要卡：${esc(c.patient.name)}</h1>
  <div class="card stack" id="cardBox"><p>目前：第 ${live.v} 版　${pill(live.status, live.status === '已開放' ? 'ok' : 'mute')}${ch.length ? ' ' + pill('待重新審核', 'warn') : ''}　審核：${esc(R.accName(live.opened_by))}，${esc(toStamp(live.opened_at) || '')}　開放給 ${esc(names(live.caregivers))}</p>
    ${live.status === '已停用' ? `<p class="small muted">停用：${esc(toStamp(live.end_at) || '')}　${esc(live.end_note || '')}</p>` : ''}
    ${ch.length ? `<div class="notice warn">摘要卡依據的已確認資料有變更：<strong>${esc(ch.join('、'))}</strong>。照服員畫面已將這些欄位改為「請問護理站」，請按「修訂內容」產生新版本並審核。</div>` : ''}
    ${c.closed ? '' : `<div class="row"><button type="button" class="btn" id="cardRevise">修訂內容（產生新版本）</button>${live.status === '已開放' ? '<button type="button" class="btn danger" id="cardStop">停用摘要卡</button>' : '<button type="button" class="btn" id="cardResume">重新開放</button>'}</div>`}
    ${hist.length ? `<details><summary class="small">歷史版本（${hist.length}）</summary>${hist.slice().reverse().map(h => `<p class="small">第 ${h.v} 版　${pill(h.status, 'mute')}　${esc(R.accName(h.opened_by))} 審核，${esc(toStamp(h.opened_at) || '')} 開放，${esc(toStamp(h.end_at) || '')} ${esc(h.status)}${h.end_note ? '：' + esc(h.end_note) : ''}</p>`).join('')}</details>` : ''}
    <p class="small muted">照服員看到的內容：區塊 A 健康與照護重點、區塊 B 家屬提供之生活資訊、用藥安全提示；看不到原始文件、證件、契約與費用。</p>
  </div>`;
  /* 修訂：由已確認資料帶入的欄位重新產生；護理自行填寫的照護提醒、提示與開放對象沿用舊版，仍須重新審核（原型 card-revise） */
  main.querySelector('#cardRevise')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    const content = Object.assign(clone(live.content || {}), CR.cardFromData(c), { why: ch.length ? '資料變更：' + ch.join('、') : '護理修訂' });
    const { error } = await supabase().rpc('revise_care_card', { p_case: c.id, p_expect_v: live.v, p_content: content });
    if (error){ e.currentTarget.disabled = false; return toast('建立摘要卡新版本失敗：' + errText(error)); }
    done('已建立新版本草稿，請審核後開放');
  });
  main.querySelector('#cardStop')?.addEventListener('click', () => modal({ title: '停用照顧摘要卡', ok: '停用', danger: true,
    body: '<p>停用後，照服員會看到「已停用，請問護理站」，不會再看到內容。</p><label class="f" data-req>原因<input type="text" id="stNote" placeholder="例：住民轉院，內容需重新評估"></label>',
    onOk: async host => { const n = host.querySelector('#stNote').value.trim(); if (!n) return '請填寫原因';
      const { error } = await supabase().rpc('stop_care_card', { p_case: c.id, p_note: n });
      if (error) return '停用失敗：' + errText(error); done('已停用'); return ''; } }));
  main.querySelector('#cardResume')?.addEventListener('click', async e => {
    if (!R.canProcess(c)) return toast('案件已結案或授權已撤回，不能開放');
    if (R.cardChanged({ ...c, card: { ...c.card, status: '已開放' } }).length) return toast('摘要卡依據的資料已變更，請改用「修訂內容」產生新版本並審核');
    /* 伺服器端（Edge Function care-card）用同一份規則再檢查一次依據是否變更，通過才重新開放 */
    const b = e.currentTarget; b.disabled = true;
    const { data, error } = await supabase().functions.invoke('care-card', { body: { action: 'resume', case_id: c.id } });
    let reason = data && !data.ok ? data.reason : '';
    if (error){ reason = error.message; try { reason = (await error.context.json()).error || reason; } catch { /* 沿用原訊息 */ } }
    if (reason){ b.disabled = false; return toast('重新開放失敗：' + reason); }
    done('已重新開放');
  });
}

/* ========== 照服員：看摘要卡（原型 careCard） ========== */
let careLang = 'zh';
async function careCard({ main }, caseId){
  const { data, error } = await supabase().functions.invoke('care-card', { body: { case_id: caseId } });
  if (error){ main.innerHTML = `${backLink('dashboard.html', '回到住民清單')}<div class="card stack"><h1>找不到這張摘要卡</h1><p>只會顯示護理師開放給您的住民。</p></div>`; return; }
  const card = Object.assign({}, data.card.content || {}, { v: data.card.v, status: data.card.status }), k = data.card;
  const back = backLink('dashboard.html', '回到住民清單');
  if (k.status === '已停用') return void (main.innerHTML = `${back}<h1>照顧摘要卡：${esc(k.patient_name)}</h1><div class="card hero bad"><h2>這張摘要卡已停用</h2><p>內容可能已經不正確，請不要依照舊的內容照顧。請直接詢問護理站。</p><p class="small muted">${esc(toStamp(k.end_at) || '')}　${esc(k.end_note || '')}</p></div>`);
  const render = () => {
    const L = LANG[careLang], ch = data.changed || [], FAM = ['call', 'comm', 'routine', 'adl', 'prefs', 'soothe', 'famNote', 'habit'];
    /* 依據資料已變更：受影響欄位不顯示舊內容，避免被當成最新資訊（原型 MAPF） */
    const MAPF = { '文件版本': [], '管路': ['tube', 'food'], '藥物過敏': ['allergy'], '用藥': ['hint'], '移位方式': ['move'], '稱呼': ['call'], '語言與溝通': ['comm', 'habit'], '作息': ['routine', 'habit'], '喜好': ['prefs', 'habit'], '主要健康問題': ['dx'], '傷口': ['wound'], '管路照護資料': ['tube'], '傷口照護資料': ['wound'], '吞嚥與飲食': ['food'], '家屬生活與照護習慣卡': FAM };
    const staleF = new Set(ch.flatMap(n => MAPF[n] || []));
    const lab = key => `<div class="cl">${esc(L[key])}${careLang !== 'zh' ? `<small>${LANG.zh[key]}</small>` : ''}</div>`;
    const SRC_OF = Object.fromEntries(CARD_A.map(([key, , s]) => [key, s]));
    const block = (key, alert) => staleF.has(key) ? `<div class="cblock alert" data-k="${key}">${lab(key)}<div class="cv">資料已更新，請問護理站</div></div>` : `<div class="cblock ${alert ? 'alert' : ''}" data-k="${key}">${lab(key)}<div class="cv">${esc(card[key] || (FAM.includes(key) ? '家屬未提供' : '待確認，請問護理站'))}<div>${srcTag(FAM.includes(key) ? 'fam' : SRC_OF[key] || 'nurse')}</div></div></div>`;
    main.innerHTML = `${back}
    <div class="row between"><h1>${esc(L.title)}：${esc(k.patient_name)}</h1>
    <div class="seg" role="group" aria-label="欄位標題語言">${[['zh', '中文'], ['id', 'Bahasa'], ['vi', 'Tiếng Việt']].map(([key, n]) => `<button type="button" data-lang="${key}" aria-pressed="${careLang === key}">${n}</button>`).join('')}</div></div>
    ${careLang !== 'zh' ? '<p class="small muted" id="langNote">欄位標題的印尼文、越南文翻譯尚未經母語人士確認；內容仍是中文。</p>' : ''}
    <p class="lead">${esc(L.arrive)}：${slash(k.planned_admit)}　第 ${k.v} 版，${esc(toStamp(k.opened_at) || '')} 由 ${esc(k.opened_by_name || '')} 確認</p>
    ${ch.length ? `<div class="card hero warn" style="margin-bottom:12px" id="staleNote"><h2>資料已更新，需重新確認／產生摘要卡</h2><p>這張卡依據的資料已更新（${esc(ch.join('、'))}），護理師正在重新確認。標示「請問護理站」的欄位不要照舊內容照顧，請先詢問護理站。</p></div>` : ''}
    ${card.layout === 2 ? `<h2 style="margin-top:6px">A. ${esc(L.secA)}</h2>` : ''}
    <div class="ccard">${card.layout === 2 ? '' : block('call')}${card.layout === 2 ? block('dx') : ''}${block('allergy', true)}${block('risk', true)}
      <div class="cblock alert" data-k="hint">${lab('hint')}<div class="cv">${staleF.has('hint') ? '用藥資料已更新，請問護理站' : card.hints && card.hints.length ? card.hints.map(esc).join('<br>') : '無'}<div>${srcTag('nurse')}</div></div></div>
      ${block('move')}${block('food')}${block('tube')}${card.layout === 2 ? block('wound') : block('habit')}</div>
    ${(card.pending || []).filter(pd => pd.show !== false).length ? `<div class="ccard" style="margin-top:10px">${card.pending.filter(pd => pd.show !== false).map(pd => `<div class="cblock alert"><div class="cl">${esc(L.pending)}${careLang !== 'zh' ? `<small>${LANG.zh.pending}</small>` : ''}</div><div class="cv">${esc(pd.label)}：家屬提到「${esc(pd.fam)}」，與已確認資料「${esc(pd.conf)}」不同，護理站確認中。照顧前請先問護理站。<div>${srcTag('pend')}</div></div></div>`).join('')}</div>` : ''}
    ${card.layout === 2 ? `<h2 style="margin-top:18px">B. ${esc(L.secB)}</h2><p class="small muted">由家屬提供，幫助您認識住民；不是醫療或護理判斷。</p><div class="ccard">${CARD_B.map(([key]) => block(key)).join('')}</div>` : ''}
    <p class="help">內容只能查看，不能修改。有疑問請問護理站。</p>`;
    main.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { careLang = b.dataset.lang; render(); }));
  };
  render();
}
