/* 帳號相關的格式檢查（純函式，不碰資料庫，可單元測試）。規則與原型第 (18) 版相同。
 * 資料庫端另有同樣的檢查（public.phone_norm），前端檢查只是讓使用者馬上看到錯誤。 */

/* 角色代碼 → 畫面名稱（角色代碼沿用原型，不改名） */
export const ROLE_NAME = { family: '家屬／申請人', staff: '行政／社工', nurse: '護理人員', care: '照顧服務員', admin: '系統管理員' };

/* 密碼：至少 8 碼，需同時有英文字母和數字 */
export const pwOk = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const PW_HINT = '至少 8 碼，需同時有英文字母和數字';

/* 電子郵件：只能使用英文字母、數字與 . _ + - */
export const emailOk = e => /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e || '');

/* 手機號碼（臺灣）：去掉空白、連字號、括號後須為 09 開頭 10 碼數字；儲存成 0912-345-678 */
export const phoneDigits = x => String(x || '').replace(/[\s\-()]/g, '');
export const phoneValid = x => /^09\d{8}$/.test(phoneDigits(x));
export const phoneNorm = x => { const d = phoneDigits(x); return d.slice(0, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7); };
export const phoneMsg = x => !String(x || '').trim() ? '請輸入手機號碼' : !phoneValid(x) ? '請輸入正確的手機號碼，例如 0912-345-678' : '';

/* 入口與帳號類型：入口只決定畫面，權限依帳號角色。待審核的員工帳號 role 為空，用申請的角色（want）判斷。
 * 回傳錯誤訊息；入口與帳號一致時回傳空字串。 */
export function portalMismatch(portal, profile){
  const isFamily = (profile.role || profile.want) === 'family';
  if (portal === 'applicant' && !isFamily) return '這是機構工作人員帳號，請改從「機構工作人員」入口登入。要為自己或家人申請入住，請用個人電子郵件另外註冊一般申請人帳號（工作帳號不能提出入住申請）。';
  if (portal === 'staff' && isFamily) return '這是一般申請人帳號，請改從「一般申請人」入口登入。';
  return '';
}
