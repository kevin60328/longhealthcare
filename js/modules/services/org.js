/* 機構設定（org_settings 只有一列）。登入頁也要顯示機構名稱與電話，所以未登入（anon）也能讀。
 * 讀取失敗時回傳 null，畫面改用 config 的預設名稱，不擋住登入。 */
import { supabase } from '../../api/supabase.js';

let cache = null;
export async function getOrg(){
  if (cache) return cache;
  const { data, error } = await supabase().from('org_settings').select('name, phone, hours').eq('id', 1).maybeSingle();
  if (error){ console.warn('讀取機構設定失敗', error); return null; }
  cache = data;
  return cache;
}
