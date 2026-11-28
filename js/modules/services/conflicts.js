/* 「同一身分證字號、住民資料不同」而沒有建立的申請（使用者決定的流程，階段 4）。
 * 行政在工作清單看到、電話確認後標示已處理（RPC resolve_resident_conflict）。
 * 這是原型沒有的功能，所以不在 rules/tasks()（原型對照）裡，另外計入工作清單徽章。 */
import { supabase } from '../../api/supabase.js';

/* 尚未處理的紀錄：申請人姓名電話、送出的住民資料、系統既有的住民資料 */
export async function openConflicts(){
  const { data, error } = await supabase().from('resident_conflicts')
    .select('id, submitted_name, submitted_birth, created_at, residents(name, nid, birth), family:profiles!resident_conflicts_family_id_fkey(name, phone, email)')
    .is('resolved_at', null).order('created_at');
  if (error) throw error;
  return data;
}

/* 已處理的紀錄（行政「已完成」分頁顯示）：誰、何時、怎麼處理（resolved_by、resolution；2026/11/28 資料庫清理時決定顯示） */
export async function resolvedConflicts(){
  const { data, error } = await supabase().from('resident_conflicts')
    .select('id, submitted_name, created_at, resolved_at, resolution, family:profiles!resident_conflicts_family_id_fkey(name), resolver:profiles!resident_conflicts_resolved_by_fkey(name)')
    .not('resolved_at', 'is', null).order('resolved_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function countOpenConflicts(){
  const { count, error } = await supabase().from('resident_conflicts').select('id', { count: 'exact', head: true }).is('resolved_at', null);
  if (error){ console.warn('住民資料待確認數量讀取失敗', error); return 0; }
  return count || 0;
}
