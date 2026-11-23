/* Edge Function：admin-users（HANDOFF 8.5：需要 service role 的 Auth Admin API）
 *
 * 目前只有「重設臨時密碼」需要 Auth Admin API（原型 acc-reset）；核准、退回、停用、變更角色、分配權限都是資料庫 RPC（migrations/…000033）。
 * 流程：確認呼叫者是啟用中的管理員 → 產生臨時密碼 → Auth Admin API 更新密碼 → 標示首次登入要改密碼、記操作紀錄。
 * 臨時密碼只回傳給這次呼叫的管理員畫面顯示一次，不寫進資料庫或紀錄。
 *
 * 呼叫：supabase.functions.invoke('admin-users', { body: { action: 'reset', user_id } }) → { ok, password } */
import { adminClient, caller, json, CORS } from '../_shared/server.ts';

/* 臨時密碼：符合密碼規則（至少 8 碼、含英文字母與數字），用密碼學亂數產生 */
function tempPassword(){
  const abc = 'abcdefghjkmnpqrstuvwxyz', dig = '23456789', bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = 'Tmp';
  for (let i = 0; i < 6; i++) s += abc[bytes[i] % abc.length];
  return s + dig[bytes[6] % dig.length] + dig[bytes[7] % dig.length];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = adminClient();
    const me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    if (me.role !== 'admin') return json({ error: '只有系統管理員可以操作' }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.action !== 'reset') return json({ error: '不支援的操作' }, 400);
    const id = String(body.user_id || '');
    if (id === me.id) return json({ ok: false, reason: '不能重設自己的密碼，請用「修改密碼」' });
    const { data: target } = await admin.from('profiles').select('id, name').eq('id', id).maybeSingle();
    if (!target) return json({ ok: false, reason: '找不到這個帳號' });
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ ok: false, reason: '密碼更新失敗：' + error.message });
    const { error: me2 } = await admin.rpc('mark_password_reset', { p_id: id, p_by: me.id });
    if (me2) return json({ ok: false, reason: '密碼已更新，但「首次登入要改密碼」標示失敗：' + me2.message + '。請再重設一次。' });
    return json({ ok: true, password });
  } catch (e) {
    console.error(e);
    return json({ error: '帳號管理失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
