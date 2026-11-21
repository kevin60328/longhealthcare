/* 導覽列徽章（紅色數字）。數字只依資料計算，切換分頁不影響（HANDOFF 6.3）。規則與原型 topBar() 相同：
 *   家屬「通知」＝未讀通知數
 *   可分配護理師「案件分配」＝待分配案件數（原型 assignState＝待分配）
 *   行政／護理「工作清單」＝待辦數（原型 tasks().length，規則在 rules/core.js）
 *   管理員「帳號管理」＝待審核帳號數（原型管理員的 tasks() 就是待審核帳號）
 *   家屬「我的申請」、照服員「我的住民」：原型 tasks() 對這兩個角色沒有待辦，所以不顯示
 * 回傳 { 分頁 key: 數量 }；查詢失敗的分頁不顯示徽章。 */
import { supabase } from '../../api/supabase.js';
import { loadModel } from './model.js';

async function countOf(query){
  const { count, error } = await query;
  if (error){ console.warn('徽章數量讀取失敗', error); return 0; }
  return count || 0;
}

/* me：profiles 列 */
export async function badgeCounts(me){
  const db = supabase();
  const out = {};
  if (me.role === 'family'){
    out.notices = await countOf(db.from('notices').select('id', { count: 'exact', head: true }).eq('to', me.id).is('read_at', null));
  }
  if (me.role === 'staff' || me.role === 'nurse'){
    try {
      const { D, R } = await loadModel(me);
      out.home = R.tasks().length;
      if (me.role === 'nurse' && me.can_assign_nurse) out.assign = Object.values(D.cases).filter(c => R.assignState(c) === '待分配').length;
    } catch (e){ console.warn('待辦數讀取失敗', e); }
  }
  if (me.role === 'admin'){
    out.accounts = await countOf(db.from('profiles').select('id', { count: 'exact', head: true }).eq('status', '待審核'));
  }
  return out;
}
