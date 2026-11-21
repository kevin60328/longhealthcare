/* 角色能不能進某一頁／某個 view 的「畫面判斷」（HANDOFF 5、6.1）。
 * 這只決定要不要畫出頁面；真正的資料保護在資料庫的 RLS 與 RPC，前端隱藏不等於權限控制。 */
import { isTestEnv } from './config.js';

/* 各角色登入後的首頁 */
export const HOME = {
  family: 'dashboard.html',
  staff: 'dashboard.html',
  nurse: 'dashboard.html',
  care: 'dashboard.html',
  admin: 'settings.html?view=accounts'
};
export const homeOf = me => (me && HOME[me.role]) || 'login.html';

/* 每頁可以進入的角色（HANDOFF 6.1「使用者」欄） */
const PAGE_ROLES = {
  dashboard: ['family', 'staff', 'nurse', 'care'],
  application: ['family', 'staff'],
  cases: ['staff', 'admin', 'nurse'],         // 護理只能進「案件分配」，而且要有分配權限（見下方）
  documents: ['family', 'staff', 'nurse'],
  assessment: ['nurse'],
  'care-summary': ['nurse', 'care'],
  settings: ['admin']
};

/* me：profiles 列；page：頁面名稱（不含 .html）；view：網址的 view 參數 */
export function canEnter(me, page, view){
  if (!me || me.status !== '啟用' || !me.role) return false;
  if (!(PAGE_ROLES[page] || []).includes(me.role)) return false;
  if (page === 'cases' && me.role === 'nurse') return view === 'assign' && me.can_assign_nurse === true;
  if (page === 'settings' && view === 'testdata') return isTestEnv();   // 測試資料功能只在測試環境
  return true;
}
