// Minimal in-memory stand-in for claude.use('db'|'user'|'assets'), used only for local testing.
(function(){
  const store = new Map(Object.entries(window.__SEED || {}));
  const listeners = new Set();
  let n = 0;
  const clone = o => JSON.parse(JSON.stringify(o));
  const fire = () => setTimeout(() => listeners.forEach(l => l()), 0);
  const snapDoc = (path) => { const id = path.split('/').pop(); const ex = store.has(path); const d = ex ? Object.freeze(clone(store.get(path))) : undefined; return {id, exists:ex, data:() => d, metadata:{fromCache:false,hasPendingWrites:false}}; };
  function docRef(path){ return {
    id: path.split('/').pop(), path,
    get: async () => snapDoc(path),
    set: async (d) => { if (window.__writeDelay) await new Promise(r => setTimeout(r, window.__writeDelay)); if (window.__failWrite && path.startsWith(window.__failWrite)) throw {code:'unavailable', message:'mock write failure'}; store.set(path, clone(d)); fire(); },
    update: async (d) => { if (!store.has(path)) throw {code:'invalid_argument'}; store.set(path, Object.assign(store.get(path), clone(d))); fire(); },
    delete: async () => { if (window.__failWrite && path.startsWith(window.__failWrite)) throw {code:'unavailable', message:'mock write failure'}; store.delete(path); fire(); },
    acquire: async (o) => { window.__leases = window.__leases || {}; const now = Date.now(), L = window.__leases[path]; if (L && L.exp > now && L.holder !== o.holder) return {acquired:false, expiresAt:new Date(L.exp).toISOString()}; window.__leases[path] = {holder:o.holder, exp: now + (o.ttlMs || 30000)}; return {acquired:true, version:1, holder:o.holder}; },
    onSnapshot: (next) => { const l = () => next(snapDoc(path)); listeners.add(l); setTimeout(l, 5); return () => listeners.delete(l); },
    collection: (p) => collRef(path + '/' + p)
  }; }
  function query(path, ord, lim){ return {
    where(){ return this; },
    orderBy: (f, dir) => query(path, [f, dir || 'asc'], lim),
    limit: (k) => query(path, ord, k),
    get: async () => run(),
    onSnapshot: (next) => { const l = () => next(run()); listeners.add(l); setTimeout(l, 5); return () => listeners.delete(l); }
  }; function run(){ const depth = path.split('/').length + 1; let keys = [...store.keys()].filter(k => k.startsWith(path + '/') && k.split('/').length === depth);
      let docs = keys.map(snapDoc); if (ord){ docs.sort((a, b) => { const x = a.data()[ord[0]], y = b.data()[ord[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (ord[1] === 'desc' ? -1 : 1); }); } if (lim) docs = docs.slice(0, lim);
      return {docs, size:docs.length, empty:!docs.length, docChanges:() => [], metadata:{fromCache:false,hasPendingWrites:false}}; } }
  function collRef(path){ const q = query(path); return Object.assign(q, {path, doc:(id) => docRef(path + '/' + (id || ('auto' + (++n) + Math.random().toString(36).slice(2,8)))), add: async (d) => { const r = docRef(path + '/auto' + (++n)); await r.set(d); return r; }}); }
  const db = { doc: docRef, collection: collRef };
  const user = { id: async () => 'viewer1' };
  window.__store = store;
  const sample = Object.assign(async () => ({text:''}), { limits: async () => ({images:true}), json: async (prompt, opts) => { window.__sampleCalls = (window.__sampleCalls||0)+1; if (window.__ocrDelay) await new Promise(r => setTimeout(r, window.__ocrDelay)); if (window.__ocrNext) { const r = window.__ocrNext; window.__ocrNext = null; return r; } if (window.__ocrFail) { const c = window.__ocrFail; window.__ocrFail = null; throw {code:c, message:'mock'}; } if (!opts || !opts.images || !(opts.images[0] instanceof Blob)) throw {code:'invalid_argument'}; return (/"date"/.test(prompt) && !/"res"|"content"/.test(prompt)) ? {date:'2026-11-05'} : /"meds"/.test(prompt) ? {meds:['Aspirin 100 mg 每日一次','Metformin 500 mg 每日兩次'], note:'飯後服用'} : {dx:'腦中風', dc:'民國115年', tube:'無', allergy:'', wound:'無', dnr:'未簽署', date:'2026-11-05', res:'陰性'}; } });
  window.claude = { use: async (name) => name === 'db' ? db : name === 'user' ? user : name === 'sample' ? sample : null };
})();
/* 測試前置（僅供回歸測試）：八大項把習慣卡改為第一階段必填後，與習慣卡無關的舊測試流程
 * 由這裡在「必要文件都已確認、尚未評估」時自動補上「家屬正式提交＋護理初審完成」。
 * 測試習慣卡本身的套件會設 window.__autoHabit = false 關閉。 */
(function(){
  if (window.__autoHabit === undefined) window.__autoHabit = true;
  const busy = new Set(); window.__autoHabitLog = [];
  const fix = async (cid) => {
    const st = window.__store, x = JSON.parse(JSON.stringify(st.get('cases/' + cid)));
    const base = Object.assign({call:'測試稱呼', lang:['國語'], hearing:'聽力正常', famAllergy:'無'}, Object.fromEntries(ADL_KEYS.map(([k]) => ['adl_' + k, '不清楚'])), (x.habit && x.habit.sub && x.habit.sub.data) || (x.habit && x.habit.data) || {});
    const dflt = Object.assign({call:'測試稱呼', lang:['國語'], hearing:'聽力正常', famAllergy:'無'}, Object.fromEntries(ADL_KEYS.map(([k]) => ['adl_' + k, '不清楚'])));
    Object.keys(dflt).forEach(k => { if (!filledVal(base[k])) base[k] = dflt[k]; });
    const at = stamp(), ts = Date.now(), rev = ((x.habit && x.habit.rev) || 0) + 1, fam = x.familyId, n = ((x.habit && x.habit.sub && x.habit.sub.n) || 0) + 1;
    x.habit = Object.assign({}, x.habit || {}, {fmt:2, data:base, rev, updatedAt:at, updatedBy:fam, src:'家屬提供'});
    x.habit.sub = {data:JSON.parse(JSON.stringify(base)), rev, at, ts, by:fam, n};
    x.habit.subHist = (x.habit.subHist || []).concat([{n, rev, at, ts, by:fam}]);
    const c1 = Object.assign({id:cid}, x), nurse = x.nurseId || 'nurse@example.com';
    const diffRes = cardDiffs(c1).map(d => ({k:d.k, fam:d.fam, conf:d.conf, res:'測試前置：已確認'}));
    x.habitReview = {state:'審核完成', rev, by:nurse, at, note:'測試前置', done:{rev, by:nurse, at, ts, note:'測試前置', snap:JSON.parse(JSON.stringify(base)), med:medSnap(c1), diffRes}, hist:((x.habitReview || {}).hist || []).concat([{state:'審核完成', rev, by:nurse, at, ts, note:'測試前置', diffRes, changed:[]}])};
    await db.doc('cases/' + cid).set(x); window.__autoHabitLog.push(cid);
  };
  setInterval(() => {
    if (!window.__autoHabit || typeof D === 'undefined' || !D.cases || typeof habitGate !== 'function') return;
    Object.values(D.cases).forEach(c => {
      if ((window.__autoHabitSkip || []).includes(c.id)) return;
      if (busy.has(c.id) || c.closed || c.assessment || !consentOk(c) || habitGate(c)) return;
      if (!docsReady(c)) return;
      busy.add(c.id); fix(c.id).finally(() => setTimeout(() => busy.delete(c.id), 500));
    });
  }, 60);
})();
