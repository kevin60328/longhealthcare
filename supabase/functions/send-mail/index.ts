/* Edge Function：send-mail（HANDOFF 8.5、10.4 補件 Email）
 *
 * 每個正式補件只有一筆通知工作（mail_jobs.id = 'req_' || 補件 id）。寄送流程（可以重複執行、不會重複寄出）：
 *   1. 確認這個補件事件仍開啟（資料庫 req_event，與 rules/core.js 的 mailReqEvent 同一套判斷，有逐筆比對測試）；
 *      已結案、已有下一次補件、文件已刪除都不寄
 *   2. 沒有通知工作就建立（ensure_req_mail）
 *   3. 認領（claim_mail_job）：只有待寄送／寄送失敗，或寄送中超過 2 分鐘才能認領；兩個人同時按，只有一個人認領成功
 *   4. 認領後、送出前再確認一次；補件剛好結案就取消寄送並還原狀態（release_mail_job，保留紀錄）
 *   5. 送出（mailSend，idempotencyKey = 通知工作 id）
 *   6. 回寫（finish_mail_job）：只有同一個 send_key 才能寫入；寫回失敗時狀態維持「寄送中」，逾時後才能重新認領
 *
 * 郵件服務：測試環境尚未介接（HANDOFF 15-3 待使用者決定），mailSend 是「模擬」：不寄出任何信，
 * 狀態記「模擬已寄送（測試環境未實際寄出）」。正式介接時只替換 mailSend。
 * 信件內容只有住民姓名、文件名稱、期限與登入提醒，不含病歷、診斷、檢驗數值、身分證字號（HANDOFF 3.3）。
 *
 * 呼叫：supabase.functions.invoke('send-mail', { body })
 *   { case_id, mode: 'sync' }                      補齊這個案件所有開啟中補件的通知（新增補件、狀態改變後呼叫）
 *   { case_id, mode: 'create', request_id }        「待建立／建立失敗」的補件：只建立通知並寄送，不新增補件
 *   { case_id, mode: 'retry', job_id }             寄送失敗或逾時的通知：重試
 *   simulate_failure: true                         只在模擬模式有效：讓這次寄送失敗（測試「寄送失敗 → 重試」用）
 * 權限：啟用中的行政，或這個案件的承辦護理師。回傳 { results: [{ request_id, job_id, ok, reason, closed }] } */
import { adminClient, caller, json, CORS } from '../_shared/server.ts';
import { MAIL_EVENT_WORD } from '../_shared/core.js';

const SIMULATED = (Deno.env.get('MAIL_ADAPTER') || 'simulated') === 'simulated';

/* 郵件服務 adapter（目前是模擬）。opt.idempotencyKey：同一個補件事件固定不變，正式郵件服務可用它避免重複寄送 */
async function mailSend(_job: any, opt: { idempotencyKey: string, simulateFailure: boolean }): Promise<{ ok: boolean, error?: string }>{
  if (opt.simulateFailure) return { ok: false, error: '模擬寄送失敗（郵件服務無回應）' };
  return { ok: true };
}

/* 補件事件狀態：open／closed／replaced／gone／missing（已確認符合但補件關閉紀錄沒寫入） */
const WORD: Record<string, string> = { ...(MAIL_EVENT_WORD as any), missing: '文件已確認符合，補件應已關閉，不再寄送（補件關閉紀錄尚未寫入，資料狀態待修復）' };
async function eventOf(admin: any, reqId: string){
  const { data, error } = await admin.rpc('req_event', { p_request: reqId });
  if (error) throw error;
  return String(data);
}
const evWord = (ev: string) => WORD[ev] || '補件已結案，不再寄送';
const sent = (s: string) => s.startsWith('模擬已寄送') || s === '已寄送';

async function sendOne(admin: any, reqId: string, by: any, simulateFailure: boolean){
  const out = { request_id: reqId, job_id: 'req_' + reqId, ok: false, reason: '', closed: false };
  const e0 = await eventOf(admin, reqId);
  if (e0 !== 'open') return { ...out, closed: true, reason: evWord(e0) };
  const { data: job, error: je } = await admin.rpc('ensure_req_mail', { p_request: reqId });
  if (je || !job?.id) return { ...out, reason: '建立 Email 通知工作失敗' + (je ? '：' + je.message : '') };
  if (sent(String(job.status))) return { ...out, reason: '這筆補件通知已寄送過，不重複寄送' };
  const sendKey = job.id + '#' + Date.now() + '#' + crypto.randomUUID().slice(0, 8);
  const { data: claimed } = await admin.rpc('claim_mail_job', { p_job: job.id, p_by: by.id, p_send_key: sendKey });
  if (!claimed?.id){
    const { data: now } = await admin.from('mail_jobs').select('status, claim_by').eq('id', job.id).single();
    if (now?.status === '寄送中'){
      const { data: who } = await admin.from('profiles').select('name').eq('id', now.claim_by).maybeSingle();
      return { ...out, reason: (who?.name || '其他人') + ' 正在寄送這筆通知，請稍後再查看結果' };
    }
    return { ...out, reason: sent(String(now?.status || '')) ? '這筆補件通知已寄送過，不重複寄送' : '這筆通知目前不能寄送' };
  }
  /* 認領後、送出前再確認一次 */
  const e1 = await eventOf(admin, reqId);
  if (e1 !== 'open'){
    await admin.rpc('release_mail_job', { p_job: job.id, p_send_key: sendKey, p_by: by.id, p_reason: evWord(e1), p_restore: job.status });
    return { ...out, closed: true, reason: evWord(e1) };
  }
  const res = await mailSend(claimed, { idempotencyKey: job.id, simulateFailure: SIMULATED && simulateFailure });
  const { data: wrote, error: we } = await admin.rpc('finish_mail_job', { p_job: job.id, p_send_key: sendKey, p_by: by.id, p_ok: res.ok, p_error: res.error || null });
  if (we || !wrote) return { ...out, reason: '寄送結果寫入失敗（狀態維持「寄送中」，約 2 分鐘後可以重試）' };
  return res.ok ? { ...out, ok: true } : { ...out, reason: res.error || '寄送失敗' };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    const body = await req.json().catch(() => ({}));
    const caseId = String(body.case_id || ''), mode = body.mode || 'sync';
    if (!caseId) return json({ error: '缺少案件' }, 400);
    const { data: c } = await admin.from('cases').select('id, nurse_id').eq('id', caseId).maybeSingle();
    if (!c) return json({ error: '找不到案件' }, 404);
    if (!(me.role === 'staff' || (me.role === 'nurse' && c.nurse_id === me.id))) return json({ error: '沒有權限' }, 403);

    let targets: string[] = [];
    if (mode === 'sync'){
      /* 開啟中的正式補件，而且通知還沒寄出、也不是正在寄送 */
      const { data: qs, error: qe } = await admin.from('document_requests').select('id, documents!inner(case_id)').eq('documents.case_id', caseId).is('closed_at', null).is('superseded_by', null);
      if (qe) throw qe;
      const ids = (qs || []).map((q: any) => q.id);
      const { data: jobs } = ids.length ? await admin.from('mail_jobs').select('request_id, status').in('request_id', ids) : { data: [] };
      const st: Record<string, string> = Object.fromEntries((jobs || []).map((j: any) => [j.request_id, String(j.status)]));
      for (const id of ids) if (!st[id] || !(sent(st[id]) || st[id] === '寄送中')) if (await eventOf(admin, id) === 'open') targets.push(id);
    } else if (mode === 'create'){
      const reqId = String(body.request_id || '');
      const { data: q } = await admin.from('document_requests').select('id, documents!inner(case_id)').eq('id', reqId).eq('documents.case_id', caseId).maybeSingle();
      if (!q) return json({ error: '找不到這個補件' }, 404);
      const { data: ex } = await admin.from('mail_jobs').select('id').eq('request_id', reqId).maybeSingle();
      if (ex) return json({ results: [{ request_id: reqId, ok: false, reason: '通知工作已經存在，請改用「重試寄送」' }] });
      targets = [reqId];
    } else if (mode === 'retry'){
      const { data: m } = await admin.from('mail_jobs').select('request_id').eq('id', String(body.job_id || '')).maybeSingle();
      const { data: q } = m ? await admin.from('document_requests').select('id, documents!inner(case_id)').eq('id', m.request_id).eq('documents.case_id', caseId).maybeSingle() : { data: null };
      if (!m || !q) return json({ error: '找不到通知工作' }, 404);
      targets = [m.request_id];
    } else return json({ error: '不支援的模式' }, 400);

    const results = [];
    for (const id of targets) results.push(await sendOne(admin, id, me, body.simulate_failure === true));
    return json({ results });
  } catch (e) {
    console.error(e);
    return json({ error: '補件通知處理失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
