/* Edge Function：care-card（階段 8；HANDOFF 10.8 照服員限閱）
 *
 * 照服員只能看「開放給自己、已開放（或已停用）」的摘要卡。照服員依權限讀不到案件的其他資料，
 * 但摘要卡依據的資料改變時（原型 cardChanged），受影響的欄位要改顯示「請問護理站」——這個判斷需要完整的案件資料。
 * 所以這裡用 service role 讀取，套用「同一份」業務規則（_shared/core.js）算出變更項目，只回傳：
 *   摘要卡內容（已停用時不回傳內容）、版本、開放者姓名、住民姓名與預計入住日、變更的依據名稱。
 * 不回傳任何文件、診斷原文、用藥清單或其他案件資料。
 *
 * 呼叫：supabase.functions.invoke('care-card', { body: { case_id } })
 * 權限：啟用中的照顧服務員，而且這張卡有開放給自己（資料庫 my_care_card 判斷）；其他人回 403／404。 */
import { adminClient, caller, loadCase, json, CORS } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    if (me.role !== 'care') return json({ error: '沒有權限' }, 403);
    const body = await req.json().catch(() => ({}));
    const caseId = String(body.case_id || '');
    const { data: card, error } = await admin.rpc('my_care_card', { p_user: me.id, p_case: caseId });
    if (error) throw error;
    if (!card) return json({ error: '找不到開放給您的摘要卡' }, 404);
    let changed: string[] = [];
    if (card.status === '已開放'){
      const { R, c } = await loadCase(admin, caseId);
      if (c) changed = R.cardChanged(c);
    }
    return json({ card, changed });
  } catch (e) {
    console.error(e);
    return json({ error: '讀取摘要卡失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
