/* Edge Function：ocr（HANDOFF 8.5、10.6；原型 ACT.ocr、birth-ai）
 *
 * 用 service role 讀取 Storage 裡的原始檔案，交給 Claude（Anthropic API）辨識，結果寫入 ocr_runs。
 * 辨識結果只是「建議值」：日期仍須行政對照文件確認、出生日期仍須人工比對；失敗時回報原因，畫面改成人工輸入。
 * Claude API key 只放在 Edge Function 的環境變數 ANTHROPIC_API_KEY（HANDOFF 3.2），前端拿不到。
 *
 * 模式（階段 6）：
 *   date   效期文件的檢查日期（行政「核對日期」頁）。成功且版本仍是最新版時，寫入初步日期（document_versions.date_prelim）
 *   birth  出生日期原文（行政「收件核對」頁），照文件原樣抄寫，不換算、不以年齡推算
 *   review 護理逐欄核對（階段 7，assessment.html）：依文件的核對欄位定義（_shared/fields.js，與畫面同一份）擷取各欄，
 *          結果只存在 ocr_runs，畫面併入核對草稿；每一欄仍要護理對照原始文件確認
 *
 * 模型：claude-opus-5-5。另外開啟 Anthropic 的 server-side fallback（fallbacks: "default"）：
 * 醫療文件偶爾會被安全分類器誤判而拒絕，開啟後 API 會在同一次呼叫內改用 Anthropic 建議的模型重試，避免誤判變成無法辨識。
 * 仍然拒絕（stop_reason = refusal）時記為失敗、改人工處理。
 *
 * 呼叫：supabase.functions.invoke('ocr', { body: { document_id, v, mode } })
 * 權限：date、birth 限啟用中的行政；review 限這位住民的承辦護理師。文件要在對應的步驟
 *       （date：初步符合／疑似過期；birth：待收件／身分待確認；review：待護理核對）。
 * 回傳：{ ok, run, result, reason }（失敗也回 200，reason 說明原因；畫面依此提示人工處理） */
import Anthropic from 'npm:@anthropic-ai/sdk';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { adminClient, caller, loadCase, json, CORS } from '../_shared/server.ts';
import { fieldDefs } from '../_shared/fields.js';

const MODEL = 'claude-opus-5-5';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE = 5 * 1024 * 1024;        // Claude 接受的單張圖片上限
const MAX_PDF = 20 * 1024 * 1024;

const STEP: Record<string, string[]> = { date: ['初步符合', '疑似過期'], birth: ['待收件', '身分待確認'], review: ['待護理核對'] };
const ABSENT_VALS = ['文件未記載', '未提供', '未知', '報告未列此項結果', '報告內未包含'];
/* 護理核對模式要擷取的欄位（原型 ocrDefs）：核對欄位＋效期文件的檢查日期 */
const ocrDefs = (it: any) => fieldDefs(it).concat(it.validDays ? [{ k: 'date', label: '檢查日期', type: 'date' }] : []);
/* 原型 ACT.ocr 的提示文字（逐字沿用） */
function reviewPrompt(it: any){
  const keys = ocrDefs(it).map((d: any) => `"${d.k}"：${d.label}${d.type === 'date' ? '（西元 YYYY-MM-DD）' : ''}${d.choice ? `（只能填：${d.quick.filter((q: string) => !ABSENT_VALS.includes(q)).join('／')}）` : ''}${d.type === 'labs' ? '（每行一項：項目｜數值｜單位｜參考區間｜異常 H/L/無/未判讀；報告只有文字判讀時寫「文字判讀：原文」）' : ''}`).join('\n');
  return `你是台灣長照機構的文件辨識助手。圖片是一份「${it.name}」。請只依圖片上看得到的文字擷取下列欄位，回傳一個 JSON 物件，鍵名如下：
${keys}
規則：
1. 圖片上沒寫或看不清楚的欄位填空字串 ""，不要推測或補充，也不要自行判定正常。
2. 用藥清單每行一項，包含藥名、劑量、頻次。
3. 民國年請加 1911 轉成西元。
4. 只回傳 JSON，不要其他文字。`;
}
const PROMPT: Record<string, (name: string) => string> = {
  date: name => `你是台灣長照機構的文件辨識助手。附件是一份「${name}」。請只依文件上看得到的文字，找出這份報告的檢查日期（採檢日期或報告日期）。\n規則：\n1. 民國年請加 1911 轉成西元，格式 YYYY-MM-DD。\n2. 文件上沒寫或看不清楚就填空字串 ""，不要推測。`,
  birth: () => '附件是一份台灣的醫療或身分文件。請找出住民的「出生日期」，照文件上的原樣抄寫（例如「民國 31 年 03 月 15 日」或「1942/03/15」），不要換算、不要推測，也不要用年齡推算。看不到完整出生日期時填空字串。'
};
const SCHEMA: Record<string, unknown> = {
  date: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false },
  birth: { type: 'object', properties: { birth_raw: { type: 'string' } }, required: ['birth_raw'], additionalProperties: false }
};

/* Claude API 錯誤 → 給使用者看的說明（不顯示技術細節） */
function apiReason(e: unknown){
  if (e instanceof Anthropic.RateLimitError) return '目前辨識次數太多，請過幾分鐘再試，或直接人工輸入。';
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return '辨識服務的設定有問題，請通知系統管理員；請先依文件人工輸入。';
  if (e instanceof Anthropic.BadRequestError) return '這個檔案無法辨識（可能太大或格式不支援），請直接人工輸入。';
  if (e instanceof Anthropic.APIConnectionError) return '辨識服務沒有回應，請稍後再試或直接人工輸入。';
  if (e instanceof Anthropic.APIError) return '辨識服務暫時無法使用，請稍後再試或直接人工輸入。';
  return '辨識時發生錯誤，請直接人工輸入。';
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = adminClient();
  let run: { id: string, run: number } | null = null, me: any = null;
  /* 記錄失敗並回覆（失敗紀錄寫不進去時一併說明） */
  const fail = async (reason: string) => {
    if (run){ const { error } = await admin.rpc('ocr_finish', { p_run: run.id, p_ok: false, p_result: null, p_error: reason, p_by: me.id }); if (error) reason += '（失敗紀錄也沒有保存）'; }
    return json({ ok: false, run: run?.run || null, reason });
  };
  try {
    me = await caller(admin, req);
    if (!me) return json({ error: '請先登入' }, 401);
    const body = await req.json().catch(() => ({}));
    const docId = String(body.document_id || ''), v = Number(body.v), mode = String(body.mode || '');
    if (!STEP[mode]) return json({ error: '不支援的辨識模式' }, 400);
    if (mode === 'review' ? me.role !== 'nurse' : me.role !== 'staff') return json({ error: '沒有權限' }, 403);

    const { data: doc } = await admin.from('documents').select('id, case_id, key, name').eq('id', docId).maybeSingle();
    if (!doc) return json({ error: '找不到文件' }, 404);
    const { R, c, D } = await loadCase(admin, doc.case_id);
    const it = (D as any).items[`${c.id}_${doc.key}`], cur = it && R.cur(it);
    if (mode === 'review' && (c.nurseId !== me.id || !R.nurseCanSee(it))) return json({ error: '您不是這位住民的負責護理師' }, 403);
    if (!R.canProcessItem(c, it)) return json({ ok: false, reason: '授權無效或案件已結案，不能辨識' });
    if (!cur || cur.v !== v) return json({ ok: false, reason: '文件已有新版本，請重新開啟' });
    if (!STEP[mode].includes(R.status(it, c))) return json({ ok: false, reason: '這份文件目前不在可辨識的步驟' });

    const { data: ver } = await admin.from('document_versions').select('storage_path, mime, file_size, file_removed').eq('document_id', docId).eq('v', v).single();
    if (!ver?.storage_path || ver.file_removed) return json({ ok: false, reason: '這個版本沒有可辨識的檔案，請依原始文件人工處理' });
    const isPdf = ver.mime === 'application/pdf';
    if (!isPdf && !IMAGE_TYPES.includes(ver.mime)) return json({ ok: false, reason: '這種檔案格式無法自動辨識，請依原始文件人工處理' });

    const { data: started, error: se } = await admin.rpc('ocr_start', { p_doc: docId, p_v: v, p_mode: mode, p_by: me.id, p_model: MODEL });
    if (se) return json({ ok: false, reason: se.message });
    run = started;

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return await fail('辨識服務尚未設定，請依原始文件人工處理');
    const { data: blob, error: de } = await admin.storage.from('case-files').download(ver.storage_path);
    if (de || !blob) return await fail('讀不到原始檔案');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > (isPdf ? MAX_PDF : MAX_IMAGE)) return await fail('檔案太大，無法自動辨識，請直接人工輸入');
    const data = encodeBase64(bytes);
    const file = isPdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
                       : { type: 'image', source: { type: 'base64', media_type: ver.mime, data } };

    const defs = ocrDefs(it);
    const reviewSchema = { type: 'object', properties: Object.fromEntries(defs.map((d: any) => [d.k, { type: 'string' }])), required: defs.map((d: any) => d.k), additionalProperties: false };
    const client = new Anthropic({ apiKey: key });
    let resp: any;
    try {
      resp = await client.beta.messages.create({
        model: MODEL,
        max_tokens: mode === 'review' ? 8000 : 4000,   // 護理核對欄位多（用藥、檢驗數值），留較多空間
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        /* 只是抄寫日期，用較低的思考深度（較快、較便宜）；輸出固定成 JSON 格式 */
        output_config: { effort: 'low', format: { type: 'json_schema', schema: mode === 'review' ? reviewSchema : SCHEMA[mode] } },
        messages: [{ role: 'user', content: [file, { type: 'text', text: mode === 'review' ? reviewPrompt(it) : PROMPT[mode](it.name) }] }]
      } as any);
    } catch (e){
      console.error('Claude API', e);
      return await fail(apiReason(e));
    }
    if (resp.stop_reason === 'refusal') return await fail('辨識服務無法處理這份文件，請依原始文件人工處理');
    if (resp.stop_reason === 'max_tokens') return await fail('辨識結果不完整，請再試一次或直接人工輸入');
    const text = (resp.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    let out: any;
    try { out = JSON.parse(text); } catch { return await fail('辨識結果格式不正確，請再試一次或直接人工輸入'); }

    let result: Record<string, unknown>;
    if (mode === 'review'){
      /* 全新結果：每個欄位都有值，沒辨識到的一律是空字串；不沿用前一次的任何值（原型相同） */
      const fields: Record<string, string> = {}, found: string[] = [];
      for (const d of defs as any[]){
        let val = out[d.k]; if (Array.isArray(val)) val = val.join('\n');
        val = val == null ? '' : String(val).trim();
        if (d.type === 'date' && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) val = '';
        fields[d.k] = val; if (val) found.push(d.label);
      }
      if (!found.length) return await fail('沒有辨識到可用的內容');
      result = { fields, found, summary: `擷取 ${found.length}／${defs.length} 欄，尚未確認`, model: resp.model };
    } else if (mode === 'date'){
      const d = String(out.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) return await fail('沒有辨識到可用的內容');
      result = { date: d, summary: '擷取 1／1 欄，尚未確認', model: resp.model };
    } else {
      const raw = String(out.birth_raw || '').trim();
      result = { birth_raw: raw, summary: raw ? '出生日期：' + raw + '，尚未確認' : '未辨識出完整出生日期', model: resp.model };
    }
    const { data: fin, error: fe } = await admin.rpc('ocr_finish', { p_run: run!.id, p_ok: true, p_result: result, p_error: null, p_by: me.id });
    if (fe) return json({ ok: false, run: run!.run, reason: '辨識完成，但結果沒有保存：' + fe.message });
    return json({ ok: true, run: run!.run, result, latest: fin?.latest !== false });
  } catch (e) {
    console.error(e);
    if (run) return await fail('辨識時發生錯誤，請直接人工輸入');
    return json({ error: '辨識失敗：' + ((e as Error).message || String(e)) }, 500);
  }
});
