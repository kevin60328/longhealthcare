/* 導覽列徽章（紅色數字）。數字只依資料計算，切換分頁不影響（HANDOFF 6.3）。
 * 階段 2 先做：家屬「通知」未讀數、護理「案件分配」待分配數（原型 assignState＝待分配）、
 * 管理員「帳號管理」待審核帳號數（原型管理員的 tasks() 只有待審核帳號，所以這個已是完整規則）。
 * 「工作清單」的待辦數要等階段 3 的 tasks() 規則移轉後才加上（目前不顯示，不放假數字）。
 * 回傳 { 分頁 key: 數量 }；查詢失敗的分頁不顯示徽章。 */
import { supabase } from '../../api/supabase.js';

async function countOf(query){
  const { count, error } = await query;
  if (error){ console.warn('徽章數量讀取失敗', error); return 0; }
  return count || 0;
}

export async function badgeCounts(me){
  const db = supabase();
  const out = {};
  if (me.role === 'family'){
    out.notices = await countOf(db.from('notices').select('id', { count: 'exact', head: true }).eq('to', me.id).is('read_at', null));
  }
  if (me.role === 'nurse' && me.can_assign_nurse){
    // RLS 只讓有分配權限的護理師看到「已確認、未分配、未結案」的案件，這裡再明確篩一次
    out.assign = await countOf(db.from('cases').select('id', { count: 'exact', head: true })
      .eq('link_status', '已確認').is('nurse_id', null).is('closed_at', null));
  }
  if (me.role === 'admin'){
    out.accounts = await countOf(db.from('profiles').select('id', { count: 'exact', head: true }).eq('status', '待審核'));
  }
  return out;
}
