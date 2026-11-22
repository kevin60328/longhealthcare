/* 收件核對規則（原型第 (18) 版 ID_ROWS、idProfile、MANUAL_HOW、normBirth、birthCompare，內容逐字沿用；只有加上 export）。
 * 出生日期：民國或西元先轉成 YYYY-MM-DD 再比對；不以年齡推算，看不出完整日期就交由人工。
 * tests/unit/receipt.test.js 用原型的同名函式逐一比對結果。 */
import { isDate } from './core.js';
const pad = n => String(n).padStart(2, '0');

export const ID_ROWS = [['name','姓名'],['nid','身分證字號']];
export const ID_LABEL = {name:'姓名', nid:'身分證字號', birth:'出生日期', chart:'病歷號', source:'來源機構'};
export const OWN_DOCS = ['emergency','contract','authOther','fee','payReceipt','deposit'];
/* 不同文件常見的識別資訊不同：醫院文件常只有姓名與病歷號，不一定有身分證字號或完整出生日期 */
export function idProfile(it){
  if (OWN_DOCS.includes(it.key)) return {rows:['name'], note:'機構自行簽訂或開立的文件，通常只有住民姓名；請核對住民姓名與文件內容。'};
  if (['idcopy','nhi'].includes(it.key)) return {rows:['name','nid','birth'], note:'證件通常有姓名、身分證字號與出生日期。'};
  if (it.key === 'relProof') return {rows:['name','nid','birth'], note:'戶籍資料通常有姓名、身分證統一編號與出生日期。'};
  return {rows:['name','nid','birth','chart','source'], note:'醫院或診所的文件常見姓名與病歷號，不一定有身分證字號或完整出生日期。缺少時請選「文件上沒有」，再用病歷號、來源機構或其他已核實資料人工核對。'};
}
export const MANUAL_HOW = [['已電話向來源機構確認','已電話向來源機構確認'],['已比對病歷號與來源機構','已比對病歷號與來源機構（需填寫文件上的病歷號，且來源機構相符）'],['已與同一來源先前已核實的文件比對','已與同一來源先前已核實的文件比對（來源機構需相符）'],['其他','其他（請說明）']];
/* ---------- 出生日期：民國或西元先轉成 YYYY/MM/DD 再比對；不以年齡推算，看不出完整日期就交由人工 ---------- */
export function normBirth(raw){
  const t = String(raw || '').replace(/\s+/g, '').replace(/[．。]/g, '.');
  if (!t) return {state:'empty'};
  const real = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
  const out = (y, m, d, how) => real(y, m, d) && y >= 1880 && y <= new Date().getFullYear() ? {state:'ok', iso:`${y}-${pad(m)}-${pad(d)}`, how} : {state:'bad', why:'日期不存在或年份不合理'};
  let m;
  if ((m = t.match(/(?:民國|民|ROC)(\d{1,3})[年./-](\d{1,2})[月./-](\d{1,2})日?/i))) return out(+m[1] + 1911, +m[2], +m[3], '民國 ' + m[1] + ' 年轉西元');
  if ((m = t.match(/(?:西元)?(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/))) return out(+m[1], +m[2], +m[3], '西元');
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return out(+m[1], +m[2], +m[3], '西元');
  if ((m = t.match(/^(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})$/))) return out(+m[1] + 1911, +m[2], +m[3], '年份 ' + m[1] + ' 視為民國年轉西元');
  if (/\d{1,3}歲/.test(t) || /年齡/.test(t)) return {state:'age', why:'只有年齡'};
  if (/\d/.test(t)) return {state:'partial', why:'日期不完整'};
  return {state:'bad', why:'看不出日期'};
}
export const birthSlash = iso => isDate(iso) ? '出生日期：' + iso.replace(/-/g, '/') : '';
export function birthCompare(regIso, raw, src, docName){
  const n = normBirth(raw);
  if (!isDate(regIso)) return {result:'資料不足', note:'案件基本資料缺少完整出生日期', n};
  if (n.state === 'empty') return src === 'AI 辨識' ? {result:'待人工確認', note:'AI 沒有辨識出可靠的出生日期，請對照文件填寫', n} : {result:'資料不足', note:'尚未填寫文件上的出生日期', n};
  if (n.state === 'age') return {result:'資料不足', note:`${docName || '文件'}未提供完整出生日期（只有年齡），系統不會以年齡推算`, n};
  if (n.state !== 'ok') return {result:'待人工確認', note:'無法可靠解讀：' + n.why, n};
  return {result: n.iso === regIso ? '一致' : '不一致', note:n.how, n};
}
export const BIRTH_TONE = {'一致':'ok','不一致':'bad','資料不足':'warn','待人工確認':'warn'};
