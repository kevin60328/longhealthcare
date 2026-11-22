/* 護理逐欄核對的純規則（原型第 (18) 版同名函式，逐字沿用；只加上 export）。
 * 不含畫面與儲存；tests/unit/review.test.js 直接執行原型的同名函式逐一比對結果。 */
export const ABSENT_VALS = ['文件未記載','未提供','未知','報告未列此項結果','報告內未包含'];
export const LAB_FLAGS = ['H','L','HH','LL','無','未判讀','異常'];
export function parseLabRows(text){
  const rows = [], bad = [];
  String(text || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    if (/^文字判讀[：:]/.test(l)) { rows.push({text:l.replace(/^文字判讀[：:]\s*/, '')}); return; }
    if (ABSENT_VALS.includes(l)) { rows.push({absent:l}); return; }
    const p = l.split(/[｜|]/).map(x => x.trim());
    if (p.length < 4 || !p[0] || !p[1]){ bad.push(l); return; }
    const flag = p[4] || '未判讀';
    if (!LAB_FLAGS.includes(flag.toUpperCase()) && !LAB_FLAGS.includes(flag)){ bad.push(l); return; }
    rows.push({name:p[0], value:p[1], unit:p[2], ref:p[3], flag});
  });
  return {rows, bad};
}
export const dxActive = f => (f.rows || []).filter(r => r.state !== '不採用');
export function dxRecalc(f){
  if (f.type !== 'dxlist') return f;
  f.rows = f.rows || [];
  if (f.absent){ f.val = f.absentVal || '文件未記載'; f.ok = true; return f; }
  const act = dxActive(f), okRows = act.filter(r => r.state === '已確認');
  f.val = okRows.map(r => r.text).join('、');
  const ok = act.length > 0 && okRows.length === act.length;
  if (ok){ const last = okRows.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]; f.ok = true; f.okBy = last.by; f.okAt = last.at; }
  else { f.ok = false; f.okBy = null; f.okAt = null; }
  const ai = f.rows.filter(r => /^AI/.test(r.src || ''));
  f.auto = ai.length > 0; f.orig = f.auto && !ai.some(r => r.text !== r.raw) ? f.val : (f.rawOrig || '');
  return f;
}
export const dxSplit = raw => String(raw || '').split(/\n|[、，,；;]|\s*(?:^|\s)\d+\s*[.．、)）]\s*/).map(x => x.trim()).filter(Boolean);
export const dxKey = x => String(x || '').replace(/\s/g, '');
export const dxDup = (f, p) => (f.rows || []).find(r => dxKey(r.raw) === dxKey(p) || dxKey(r.text) === dxKey(p));
export const fActive = (F, f) => !f.when || f.when.in.includes(String((F.find(x => x.k === f.when.k) || {}).val || ''));
export function fieldSrc(f){
  if (f.type === 'dxlist'){ if (f.absent) return '人工確認：' + f.val; const ai = (f.rows || []).some(r => /^AI/.test(r.src || '')), ed = (f.rows || []).some(r => r.text !== r.raw || !r.raw); return ai ? `AI 辨識（第 ${f.run || '?'} 次）` + (ed ? '後人工修改' : '') : '人工輸入'; }
  const edited = f.auto && String(f.orig || '') !== String(f.val || '');
  if (f.auto) return edited ? `AI 辨識（第 ${f.run || '?'} 次）後人工修改` : `AI 辨識（第 ${f.run || '?'} 次）`;
  return f.val ? '人工輸入' : '空白';
}
export function overallSrc(fields){
  const ai = fields.filter(f => f.auto && String(f.orig || '') === String(f.val || '')).length;
  const aiEdit = fields.filter(f => f.auto && String(f.orig || '') !== String(f.val || '')).length;
  /* 人工輸入只算實際有填內容的欄位；空白且未辨識的欄位不計入 */
  const man = fields.filter(f => !f.auto && String(f.val == null ? '' : f.val).trim() !== '').length;
  if (ai + aiEdit === 0) return man ? '人工輸入＋人工核對' : '尚無內容';
  if (aiEdit === 0 && man === 0) return 'AI 辨識＋人工核對';
  return 'AI 辨識' + (aiEdit ? '＋人工修改' : '') + (man ? '＋人工輸入' : '') + '＋人工核對';
}
export const ICD_RE = /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/;
