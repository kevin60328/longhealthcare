/* Edge Function：admin-archive（HANDOFF 8.2、10.10 保存規則；原型 archive）
 *
 * 封存已結案的案件：刪除 Storage 裡的原始檔案（要用 Storage API，所以放在伺服器端），保留版本紀錄並標示「原始檔案已刪除」，
 * 核對草稿與 AI 辨識暫存一併刪除，保留結案原因、文件清單與操作紀錄。封存後無法復原。
 * 流程：確認啟用中的管理員 → archive_targets（資料庫檢查：已結案、未封存、沒有在延長保存期限內；回傳要刪的檔案）
 *       → Storage 刪除 → archive_case_as（標示已刪除的檔案、刪暫存、記錄封存狀態；有刪除失敗時狀態為「處理未完成」）。
 *
 * 呼叫：supabase.functions.invoke('admin-archive', { body: { case_id } }) → { ok, status, removed, failed } */
import { adminClient, caller, json, CORS } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    if (me.role !== 'admin') return json({ error: '只有系統管理員可以封存' }, 403);
    const body = await req.json().catch(() => ({}));
    const caseId = String(body.case_id || '');
    const { data: paths, error: te } = await admin.rpc('archive_targets', { p_case: caseId });
    if (te) return json({ ok: false, reason: te.message });
    const removed: string[] = [];
    let failed = 0;
    /* 一次最多刪 100 個；失敗的不標示為已刪除，狀態會是「處理未完成」 */
    for (let i = 0; i < (paths || []).length; i += 100){
      const part = paths.slice(i, i + 100);
      const { data, error } = await admin.storage.from('case-files').remove(part);
      if (error){ failed += part.length; continue; }
      const ok = new Set((data || []).map((x: any) => x.name));
      for (const p of part) if (ok.has(p)) removed.push(p); else failed++;
    }
    const { data: r, error: ae } = await admin.rpc('archive_case_as', { p_case: caseId, p_by: me.id, p_removed: removed, p_failed: failed });
    if (ae) return json({ ok: false, reason: '檔案已刪除 ' + removed.length + ' 份，但封存狀態寫入失敗：' + ae.message });
    return json({ ok: true, status: r.status, removed: removed.length, failed });
  } catch (e) {
    console.error(e);
    return json({ error: '封存失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
