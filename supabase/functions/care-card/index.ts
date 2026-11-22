/* Edge Function：care-card（階段 8；HANDOFF 10.8）
 *
 * 1. 照服員看卡（預設）：照服員只能看「開放給自己、已開放（或已停用）」的摘要卡。照服員依權限讀不到案件的其他資料，
 *    但摘要卡依據的資料改變時（原型 cardChanged），受影響的欄位要改顯示「請問護理站」——這個判斷需要完整的案件資料。
 *    所以這裡用 service role 讀取，套用「同一份」業務規則（_shared/core.js）算出變更項目，只回傳：
 *      摘要卡內容（已停用時不回傳內容）、版本、開放者姓名、住民姓名與預計入住日、變更的依據名稱。
 *    不回傳任何文件、診斷原文、用藥清單或其他案件資料。
 *    呼叫：{ case_id }；權限：啟用中的照顧服務員，而且這張卡有開放給自己。
 *
 * 2. 護理重新開放已停用的卡（action: 'resume'，2026/11/23 使用者決定補上伺服器端檢查）：
 *    依同一份規則檢查「停用期間依據資料是否改變」（把卡當成已開放來比對，與原型 card-resume 相同）；
 *    有變更就拒絕，請改用「修訂內容」；沒有變更才以 service role 呼叫 resume_care_card_as（資料庫再檢查承辦身分與狀態）。
 *    呼叫：{ action: 'resume', case_id }；權限：這位住民的承辦護理師。 */
import { adminClient, caller, loadCase, json, CORS } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    const body = await req.json().catch(() => ({}));
    const caseId = String(body.case_id || '');

    if (body.action === 'resume'){
      if (me.role !== 'nurse') return json({ error: '沒有權限' }, 403);
      const { R, c } = await loadCase(admin, caseId);
      if (!c || c.nurseId !== me.id) return json({ error: '您不是這位住民的負責護理師' }, 403);
      if (!c.card || c.card.status !== '已停用') return json({ ok: false, reason: '摘要卡目前不是停用狀態' });
      const changed = R.cardChanged({ ...c, card: { ...c.card, status: '已開放' } });
      if (changed.length) return json({ ok: false, changed, reason: '摘要卡依據的資料已變更（' + changed.join('、') + '），請改用「修訂內容」產生新版本並審核' });
      const { data, error } = await admin.rpc('resume_care_card_as', { p_case: caseId, p_by: me.id });
      if (error) return json({ ok: false, reason: error.message });
      return json({ ok: true, v: data });
    }

    if (me.role !== 'care') return json({ error: '沒有權限' }, 403);
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
    return json({ error: '摘要卡處理失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
