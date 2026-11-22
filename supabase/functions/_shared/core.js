/* 自動產生：由 npm run functions:sync 從原始檔複製，請勿直接修改（改原始檔後重新同步）。 */
/* 業務規則（純函式，不碰資料庫）：從原型第 (18) 版逐行移轉，判斷結果必須與原型完全相同。
 *
 * 用法：const R = createRules(D, { me, today });
 *   D：資料模型（形狀與原型的 D 相同，由 services/model.js 從 Supabase 資料轉換）
 *      { cases:{id:案件}, items:{id:文件}, accounts:{id:帳號}, settings:機構設定, notices:{}, docKeys:[內建文件清單 key] }
 *      文件 id 一律是「案件id_文件key」（原型的慣例，proofItemOf、listMissing 都依賴這個規則）。
 *      時間欄位是台灣時間字串「YYYY/MM/DD HH:MM」，日期欄位是「YYYY-MM-DD」。
 *   me：目前登入的帳號（模型形狀 {id, role, name, status, canAssignNurse}）
 *   today：今天日期「YYYY-MM-DD」（台灣時間）。測試時固定，才能和原型輸出比對。
 *
 * 與原型的對照：每個函式名稱都與原型相同，行為有疑問時到 reference/prototype_v18.html 搜尋同名函式。
 * tests/unit/parity.test.js 會用原型實際算出來的結果比對（fixture 由 tests/parity 產生）。
 * 只移轉判斷邏輯；畫面（HTML）在各頁模組。 */

/* ---------- 共用常數（原型同名常數） ---------- */
export const ROLE_NAME = { family: '家屬／申請人', staff: '行政／社工', nurse: '護理人員', care: '照顧服務員', admin: '系統管理員' };
export const CATS = { A: '身分與聯絡資料', B: '入住前健康檢查資料', C: '醫療資料', D: '特殊照護資料', E: '授權與法律文件', F: '契約與費用', G: '其他補充文件' };
const LEGACY_CAT = { summary: 'C', meds: 'C', idcopy: 'A', guardian: 'A', xray: 'B', stool: 'B' };
export const NEEDS = ['必備', '條件式必備', '選填', '不適用'];
export const NEED_WORD = { '必備': '需要繳交', '條件式必備': '視情況繳交', '選填': '選填', '不適用': '不需要' };
export const NEED_TONE = { '必備': 'bad', '條件式必備': 'warn', '選填': 'info', '不適用': 'mute' };
export const NURSE_COND = ['tubeCare', 'woundCare', 'swallow'];
export const INST_DOCS = ['contract', 'fee', 'payReceipt', 'deposit'];
export const DONE = ['確認符合', '即將到期', '不需要', '已登錄簽約'];
export const TONE = { '待登錄簽約': 'info', '已登錄簽約': 'ok', '待簽約': 'mute', '機構尚未提供': 'mute', '未上傳': 'mute', '待收件': 'info', '身分待確認': 'bad', '待護理核對': 'info', '初步符合': 'info', '疑似過期': 'warn', '確認過期': 'bad', '需補件': 'bad', '確認符合': 'ok', '即將到期': 'warn', '不需要': 'mute' };
export const FAMILY_WORD = { '待登錄簽約': '已收到契約，等待機構登錄簽約', '已登錄簽約': '已完成簽約', '待簽約': '簽約時完成', '機構尚未提供': '機構尚未提供', '未上傳': '還沒上傳', '待收件': '已上傳，等待機構審核', '身分待確認': '已上傳，等待機構審核', '待護理核對': '已上傳，等待護理師審核', '初步符合': '已上傳，等待機構審核', '疑似過期': '已上傳，等待機構審核', '確認過期': '已過期，需要重新檢查', '需補件': '需要重新上傳', '確認符合': '已完成', '即將到期': '已完成（快到期）', '不需要': '不需要' };
export const SIGNER_LABEL = { '本人': '預計入住者本人', '監護人': '法定代理人／監護人', '代理人': '其他經適當授權的代理人', '受輔助宣告': '預計入住者本人（受輔助宣告，需確認輔助人同意）' };
const PROOF_KEYS = ['guardian', 'agentProof'];
export const MAIL_EVENT_WORD = { closed: '補件已結案，不再寄送', replaced: '已有下一次補件，這筆舊通知不再寄送', gone: '找不到對應文件，不再寄送' };
/* F9 評估結果：只有明確的通過結果才往下走 */
export const PASS = { '先審後簽': '收治', '先簽後審': '可入住' };
export const RESULTS = { '先審後簽': ['收治', '需補充', '待協調', '不收治'], '先簽後審': ['可入住', '需補充', '待協調', '不符合收治條件'] };
/* 需要行政協調後才能決定的結果：案件狀態一律為「待協調」 */
export const COORD_RESULTS = ['待協調', '不符合收治條件'];
export const PHASE_TONE = { '待代理權核實': 'warn', '摘要卡已停用': 'mute', '摘要卡待重新審核': 'warn', '待機構確認': 'warn', '待同意': 'warn', '待補件': 'bad', '評估待補件': 'bad', '文件審查中': 'info', '評估中': 'info', '已收治待簽約': 'ok', '待簽約': 'warn', '入住前文件審查': 'info', '入住前確認中': 'info', '待協調': 'warn', '摘要卡審核中': 'info', '摘要卡已開放': 'ok', '已結案': 'mute' };
export const ASSIGN_TONE = { '尚未轉交': 'mute', '已分配': 'ok', '待分配': 'warn', '未分配（已結案）': 'mute' };
export const PHASE_NEXT = { '待機構確認': '行政確認申請後，請家屬簽署個人資料同意書', '待同意': '家屬完成同意後，開始收件', '待代理權核實': '代理權核實後授權生效，開始收件', '待補件': '文件齊全後進入文件審查', '評估待補件': '補件確認後重新評估', '文件審查中': '文件確認後進入收治評估', '評估中': '評估通過後（先審後簽）等簽約；先簽後審則進入入住前確認', '已收治待簽約': '簽約後準備入住前文件', '待簽約': '簽約後進入入住前確認', '入住前文件審查': '入住前文件確認後，護理做入住前確認', '入住前確認中': '確認後產生照顧摘要卡草稿', '摘要卡審核中': '摘要卡開放後，照服員可以查看' };
export const STEP_CLS = { '已完成': 'done', '進行中': 'now', '需重新處理': 'redo', '尚未開始': '' };
export const STAFF_KINDS = ['confirm', 'handover', 'receipt', 'date', 'sign', 'req', 'req3', 'need', 'close'];
export const NURSE_KINDS = ['assign', 'review', 'need', 'req', 'assess', 'card', 'habit', 'upload'];

/* ---------- 習慣卡欄位（原型 HABIT_SECS） ---------- */
export const ADL_OPTS = ['可自行完成', '需要部分協助', '需要完全協助', '不清楚'];
export const ADL_KEYS = [['walk', '行走'], ['transfer', '移位'], ['toilet', '如廁'], ['bath', '洗澡'], ['eat', '進食'], ['swallow', '吞嚥']];
export const HABIT_SECS = [
  { k: 'A', title: '基本稱呼與溝通', fields: [
    { k: 'call', label: '住民希望被怎麼稱呼？', hint: '例：王媽媽、美玉阿嬤' },
    { k: 'lang', label: '慣用語言（可複選）', type: 'multi', opts: ['國語', '台語', '客語', '原住民族語', '日語', '英語'] },
    { k: 'langOther', label: '其他語言', hint: '例：粵語、印尼語' },
    { k: 'hearing', label: '聽力狀況', type: 'select', opts: ['聽力正常', '有點重聽，說話要大聲、放慢', '需要戴助聽器', '幾乎聽不到，要用寫字或手勢', '不清楚'] },
    { k: 'commNote', label: '其他溝通注意事項', hint: '例：要站在左邊說話、說話慢一點' }] },
  { k: 'B', title: '健康與近期狀況（家屬補充）', note: '這一區是您所知道的情況，會標示為「家屬提供」。不會寫入醫院或護理師確認過的醫療資料，也不會取代它們。', fields: [
    { k: 'famHealth', label: '您所知道的主要健康問題', hint: '例：高血壓、中風後左手無力' },
    { k: 'famAllergy', label: '您所知道的過敏（藥物、食物）', hint: '例：盤尼西林、海鮮；沒有請填「無」' },
    { k: 'recent', label: '最近半年', type: 'multi', opts: ['曾經住院', '曾經跌倒'] },
    { k: 'recentNote', label: '住院或跌倒的情形', hint: '例：9 月在浴室跌倒，沒有骨折' },
    { k: 'famWatch', label: '其他希望照顧人員注意的狀況' }] },
  { k: 'C', title: '日常活動協助', note: '依住民最近的狀況選擇，不確定可以選「不清楚」。', fields: ADL_KEYS.map(([k, l]) => ({ k: 'adl_' + k, label: l, type: 'adl' })) },
  { k: 'D', title: '生活作息', fields: [
    { k: 'wake', label: '平常起床時間', type: 'time' },
    { k: 'nap', label: '午睡習慣', type: 'select', opts: ['有午睡', '偶爾午睡', '不午睡', '不清楚'] },
    { k: 'napNote', label: '午睡補充', hint: '例：午飯後睡 1 小時' },
    { k: 'bedtime', label: '睡前習慣', hint: '例：睡前要喝溫水、要留小夜燈' },
    { k: 'bowel', label: '排便習慣', hint: '例：早上排便、需要軟便劑' },
    { k: 'night', label: '夜間起身', type: 'select', opts: ['很少起身', '會起身 1–2 次', '經常起身', '不清楚'] },
    { k: 'nightNote', label: '夜間補充', hint: '例：半夜會起來找廁所' },
    { k: 'routineNote', label: '其他作息補充' }] },
  { k: 'E', title: '個人喜好與禁忌', fields: [
    { k: 'likeFood', label: '喜歡的食物' }, { k: 'dislikeFood', label: '不喜歡的食物' },
    { k: 'likeAct', label: '喜歡的活動', hint: '例：聽老歌、看歌仔戲' }, { k: 'dislikeEnv', label: '不喜歡的聲音或環境', hint: '例：怕吵、怕冷' },
    { k: 'dislikeTouch', label: '不喜歡的碰觸或照護方式', hint: '例：不喜歡被碰頭、洗澡要先告知' }, { k: 'otherPref', label: '其他生活偏好' }] },
  { k: 'F', title: '情緒與安撫方式', fields: [
    { k: 'anxious', label: '容易焦慮或躁動的情境', hint: '例：傍晚、看不到家人時' }, { k: 'refuseWhy', label: '拒絕照護時可能的原因', hint: '例：怕冷、害羞' },
    { k: 'soothe', label: '過去有效的安撫方式', hint: '例：握著手說台語、放鄧麗君的歌' }, { k: 'interact', label: '其他需要注意的互動方式' }] },
  { k: 'G', title: '聯絡資訊', note: '正式的緊急聯絡人沿用案件資料，不用重複填寫。這裡只補充交接時要知道的說明。', fields: [
    { k: 'contactTime', label: '適合聯絡的時段', type: 'select', opts: ['白天（9–17 點）', '晚上（17–21 點）', '任何時間都可以'] },
    { k: 'contactNote', label: '給照顧人員的聯絡說明', hint: '例：上班時間請先傳訊息' }] }
];
export const HABIT_LABEL = Object.fromEntries(HABIT_SECS.flatMap(sec => sec.fields.flatMap(f => f.type === 'adl' ? [[f.k, f.label], [f.k.replace('adl_', 'adlN_'), f.label + '（說明）']] : [[f.k, f.label]])));
/* 家屬端必填欄位的簡短名稱（提示「還有必填欄位未填」用，原型 HABIT_LABEL_FAM） */
export const HABIT_LABEL_FAM = { call: '稱呼', lang: '慣用語言', hearing: '聽力狀況', famAllergy: '過敏', ...Object.fromEntries(ADL_KEYS.map(([k, l]) => ['adl_' + k, '日常活動：' + l])) };
/* 正式提交時的必要欄位（HANDOFF 10.5 HABIT_REQ） */
export const HABIT_REQ = ['call', 'lang', 'hearing', 'famAllergy'].concat(ADL_KEYS.map(([k]) => 'adl_' + k));
const HR_MED = [['allergy', '過敏'], ['tube', '管路'], ['swallow', '吞嚥']];
const CARD_DOC_KEYS = ['summary', 'meds', 'tubeCare', 'woundCare', 'swallow', 'rehab'];
const BASIS_NAME = { tube: '管路', allergy: '藥物過敏', meds: '用藥', move: '移位方式', call: '稱呼', lang: '語言與溝通', routine: '作息', likes: '喜好', dx: '主要健康問題', wound: '傷口', tubeCare: '管路照護資料', woundCare: '傷口照護資料', swallow: '吞嚥與飲食', habit: '家屬生活與照護習慣卡', docv: '文件版本' };

/* ---------- 日期工具（與原型相同；日期字串可直接比較先後） ---------- */
export const d2n = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export const addDays = (s, n) => new Date((d2n(s) + n) * 864e5).toISOString().slice(0, 10);
export const slash = s => s ? s.replace(/-/g, '/') : '';
/* 月/日（例：11/25），原型 md() */
export const md = s => s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '';
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const stampDate = s => s && /^\d{4}\/\d{2}\/\d{2}/.test(s) ? s.slice(0, 10).replace(/\//g, '-') : '';
/* 資料庫的舊文字「長輩」只在顯示時轉成「住民」（HANDOFF 10.10） */
export const uiT = t => t == null ? '' : String(t).replace(/長輩/g, '住民');
export const filledVal = v => Array.isArray(v) ? v.length > 0 : String(v == null ? '' : v).trim() !== '';
export const digestOf = d => Object.keys(d || {}).sort().filter(k => filledVal(d[k])).map(k => k + '=' + [].concat(d[k]).join('、')).join('｜');
const hvStr = v => [].concat(v == null ? [] : v).map(x => String(x).trim()).filter(Boolean).join('、');
/* 原型的「正式補件」判斷（HANDOFF 10.3）：舊版提醒留下的 req（原因只有狀態文字、沒有來源）不是補件 */
export const formalReqObj = r => !!r && (!!r.source || (!!r.reason && !['未上傳', '需補件', '確認過期', '待收件', '尚未上傳'].includes(r.reason)));
export const STEP_NAMES = c => c.flowMode === '先簽後審' ? ['資料授權', '上傳文件', '機構審查', '參訪簽約', '入住準備'] : ['資料授權', '上傳文件', '機構審查', '評估結果', '入住準備'];

export function createRules(D, { me = null, today } = {}){
  const todayStr = () => today;
  const org = () => D.settings || { name: '長照機構', phone: '', hours: '', flowMode: '先審後簽' };
  const reqDays = () => Number(org().requestDays) || 7;
  const keepDays = () => Number(org().retentionDays) || 365;
  const acct = id => (D.accounts || {})[id] || null;
  const accName = id => (acct(id) || {}).name || '（未指定）';

  /* ---------- 文件 ---------- */
  const caseItems = cid => Object.values(D.items).filter(i => i.caseId === cid).sort((a, b) => (a.order || 0) - (b.order || 0));
  const cur = it => (it.versions && it.versions.length) ? it.versions[it.versions.length - 1] : null;
  /* 補件期限：個別補件請求 > 一般提醒 > 案件的文件繳交期限 */
  function dueOf(it, c){
    if (it.req && it.req.due) return it.req.due;
    if (it.remind && it.remind.due) return it.remind.due;
    if (it.stage === '入住前') return c.preDue || (stampDate(c.signedAt) ? addDays(stampDate(c.signedAt), reqDays()) : '');
    return c.docDue || (stampDate(c.confirmedAt) ? addDays(stampDate(c.confirmedAt), reqDays()) : '');
  }
  const overdue = (it, c) => { const d = dueOf(it, c); return !!d && d < todayStr(); };

  /* ---------- F2 授權 與 F0 入住契約：分開記錄 ---------- */
  function consentState(c){
    const k = c.consent; if (!k) return '未簽署'; if (k.withdrawnAt) return '已撤回';
    if (k.state === '代理權未通過') return '代理權未通過';
    if (k.state === '待代理權核實') return '待代理權核實';
    /* 舊資料（沒有 state）：需要證明但沒有核實紀錄者視為待核實 */
    if (!k.state && k.needsProof && !(k.proofOk && k.proofCheck && k.proofCheck.result === '代理權已確認')) return '待代理權核實';
    return '有效';
  }
  /* 代理權證明文件：新資料記在 consent.proofItem；舊資料依簽署身分找 _guardian／_agentProof */
  const proofItemOf = c => { const k = (c && c.consent) || {}; return D.items[k.proofItem || (c.id + (k.signer === '代理人' ? '_agentProof' : '_guardian'))]; };
  const proofOnly = (c, it) => !!c && !!it && consentState(c) === '待代理權核實' && !c.closed && !c.archived && c.linkStatus === '已確認' && PROOF_KEYS.includes(it.key);
  const consentOk = c => consentState(c) === '有效';
  /* 舊資料相容：只有行政記錄的實際簽約時間才算已簽約 */
  const contractSigned = c => !!stampDate(c.signedAt);
  /* 可以依授權處理資料：案件未結案、未封存、已確認、授權有效 */
  const canProcess = c => !!c && !c.closed && !c.archived && c.linkStatus === '已確認' && consentOk(c);
  const canProcessItem = (c, it) => canProcess(c) || proofOnly(c, it);

  /* ---------- F6 文件效期：系統初步 → 行政確認日期 → 護理核對內容 ---------- */
  /* 原型從 OCR 結果讀 AI 日期；正式版把它存在版本的 aiDate（document_versions.date_prelim） */
  const aiDate = (it, v) => (v && v.aiDate) || '';
  const prelimDate = (it, v) => aiDate(it, v) || v.userDate || '';
  const prelimSrc = (it, v) => aiDate(it, v) ? 'AI 辨識' : v.userDate ? '家屬填寫' : '';
  const itemDate = (it, v) => v.dateConfirmed || prelimDate(it, v);
  const inValid = (it, c, date) => { if (!isDate(date)) return false; const diff = d2n(c.plannedAdmit) - d2n(date); return diff <= it.validDays && diff >= 0; };
  function checks(it, c){
    const v = cur(it);
    if (!v) return null;
    const r = { idOk: !['received', 'idPending'].includes(v.phase), sys: '—', admin: '—', nurse: '—' };
    if (it.validDays){
      const p = prelimDate(it, v);
      r.sys = isDate(p) ? (inValid(it, c, p) ? '初步符合' : '初步不符') : '無日期';
      r.admin = v.dateConfirmed ? (inValid(it, c, v.dateConfirmed) ? '日期已確認（符合）' : '日期已確認（過期）') : '待行政確認';
    }
    if (it.medical) r.nurse = v.nurseOk ? '內容已核對' : '待護理核對';
    else r.admin = (it.validDays ? r.admin + '；' : '') + (v.adminOk ? '影本已確認' : '待行政確認');
    return r;
  }

  /* ---------- 文件要求：必備／條件式必備／選填／不適用 ---------- */
  const needOf = it => NEEDS.includes(it.need) ? it.need : (it.required === false ? '不適用' : '必備');
  const condPending = it => needOf(it) === '條件式必備' && it.condMet !== true && it.condMet !== false;
  const isNeeded = it => needOf(it) === '必備' || (needOf(it) === '條件式必備' && it.condMet === true);
  const notApplicable = it => needOf(it) === '不適用' || (needOf(it) === '條件式必備' && it.condMet === false);
  /* 列入「文件是否齊全」：需要的、尚待判斷的條件式、以及家屬已上傳的選填文件 */
  const tracked = it => !notApplicable(it) && (isNeeded(it) || condPending(it) || !!cur(it));
  /* D 類照護條件式文件：是否需要由負責護理師判斷 */
  const nurseCond = it => !!it && NURSE_COND.includes(it.key) && needOf(it) === '條件式必備';
  const needAskOpen = it => !!(it && it.needAsk && !it.needAsk.doneAt);
  const byNurse = it => it.needRole === 'nurse' || ((acct(it.needSetBy) || {}).role === 'nurse');
  const needText = it => needOf(it) === '條件式必備' ? (nurseCond(it) ? (it.condMet === true ? (byNurse(it) ? '護理已確認：需要' : '已確認：需要') : it.condMet === false ? (byNurse(it) ? '護理已確認：不需要' : '已確認：不需要') : '待護理確認') : it.condMet === true ? '視情況：本案需要' : it.condMet === false ? '視情況：本案不需要' : '視情況：尚未確認') : NEED_WORD[needOf(it)];
  const instDoc = it => !!it && INST_DOCS.includes(it.key);
  const familyNeedText = it => it.key === 'contract' ? '由機構提供契約，簽約時完成，行政登錄後顯示「已完成簽約」。手邊有已簽署影本時，也可以補充上傳。' : instDoc(it) ? '由機構提供或登錄，您不需要上傳；尚未產生時不算缺件。' : notApplicable(it) ? '本案不需繳交' : needOf(it) === '選填' ? '選填，可以不繳' : nurseCond(it) && condPending(it) ? '待護理確認：護理師會依住民狀況確認是否需要。手邊如果已有相關文件，可以先上傳。' : condPending(it) ? `視情況繳交：${it.cond || '依住民狀況'}（機構確認後會通知您）` : nurseCond(it) ? '本案需要繳交（護理師已確認）' : needOf(it) === '條件式必備' ? `需要繳交（${it.cond || '依住民狀況'}）` : '需要繳交';
  const catOf = it => CATS[it.cat] ? it.cat : (LEGACY_CAT[it.key] || 'G');
  /* 護理可看的文件：健康檢查、醫療、照護紀錄（不含身分證件、契約、費用） */
  const nurseCanSee = it => !!it.medical || ['B', 'C', 'D'].includes(catOf(it));

  /* 文件狀態（HANDOFF 10.2；判斷順序與原型 status(it, c) 相同） */
  function status(it, c){
    const v = cur(it);
    if (notApplicable(it)) return '不需要';
    if (!v) return it.key === 'contract' ? (c && c.signedAt ? '已登錄簽約' : '待簽約') : instDoc(it) ? '機構尚未提供' : '未上傳';
    if (it.returned && it.returned.v === v.v) return '需補件';
    if (v.phase === 'received') return '待收件';
    if (v.phase === 'idPending') return '身分待確認';
    if (it.validDays){
      /* 行政尚未確認日期：不論系統計算或護理核對結果，都停在待確認 */
      if (!v.dateConfirmed) return inValid(it, c, prelimDate(it, v)) ? '初步符合' : '疑似過期';
      if (!inValid(it, c, v.dateConfirmed)) return '確認過期';
    }
    if (it.medical && !v.nurseOk) return '待護理核對';
    if (!it.medical && !v.adminOk) return '待收件';
    /* 上傳契約檔案不等於完成簽約：簽約以行政的簽約紀錄為準 */
    if (it.key === 'contract' && !(c && c.signedAt)) return '待登錄簽約';
    if (it.validDays){ const diff = d2n(c.plannedAdmit) - d2n(v.dateConfirmed); return (it.validDays - diff <= 7) ? '即將到期' : '確認符合'; }
    return '確認符合';
  }
  const isDone = (it, c) => DONE.includes(status(it, c));
  /* 先審後簽：簽約後才要求入住前文件；先簽後審：一開始就要求全部文件 */
  const activeStages = c => (c.flowMode === '先簽後審' || contractSigned(c)) ? ['評估前', '入住前'] : ['評估前'];
  const activeItems = c => caseItems(c.id).filter(i => tracked(i) && activeStages(c).includes(i.stage));
  const laterItems = c => caseItems(c.id).filter(i => (isNeeded(i) || condPending(i)) && !activeStages(c).includes(i.stage));
  /* 需要家屬動作：必須繳交而未上傳，或已上傳（含選填）後被要求補件、過期 */
  const familyTodo = (it, c) => ['未上傳', '確認過期', '需補件'].includes(status(it, c)) && (isNeeded(it) || !!cur(it));
  const needBy = (it, c) => it.validDays ? addDays(c.plannedAdmit, -it.validDays) : null;

  /* ---------- F7 補件（HANDOFF 10.3：所有頁面、Email、狀態共用同一套規則） ---------- */
  const formalReq = it => !!it && formalReqObj(it.req);
  const reqClosed = (it, c) => !!(it && it.req) && (!!it.req.closedAt || isDone(it, c));
  const openFormalReq = (it, c) => formalReq(it) && !reqClosed(it, c);
  /* 資料待修復：文件已確認符合，但補件的 closedAt 沒有寫入 */
  const reqCloseMissing = (it, c) => formalReq(it) && !it.req.closedAt && isDone(it, c);
  /* Email 通知對應的補件事件狀態：open／closed／replaced／gone */
  function mailReqEvent(m, it, c){
    if (!it) return 'gone';
    if (!it.req || it.req.ts !== m.reqTs){
      const h = (it.reqHistory || []).find(r => r.ts === m.reqTs);
      return h && h.closedAt ? 'closed' : it.req && it.req.ts > m.reqTs ? 'replaced' : 'closed';
    }
    return openFormalReq(it, c) ? 'open' : 'closed';
  }
  function reqState(it, c){
    if (!formalReq(it)) return null;
    if (reqClosed(it, c)) return '已關閉';
    return overdue(it, c) ? '已逾期' : '開啟中';
  }
  const assessPassed = c => !!c.assessment && c.assessment.result === PASS[c.flowMode];

  /* ---------- 習慣卡（HANDOFF 10.5） ---------- */
  const anyFilled = d => !!d && HABIT_SECS.some(sec => sec.fields.some(f => filledVal(d[f.k]) || (f.type === 'adl' && filledVal(d[f.k.replace('adl_', 'adlN_')]))));
  /* 最近一次正式提交；舊資料（沒有 fmt、已有填寫）視為已提交、提交時間未記錄 */
  function habitSub(c){
    const h = c && c.habit; if (!h) return null;
    if (h.sub) return h.sub;
    if (!h.fmt && h.rev && anyFilled(h.data)) return { data: h.data, rev: h.rev, at: null, ts: null, by: h.updatedBy || '', n: 0, legacy: true };
    return null;
  }
  const hasHabit = c => !!habitSub(c);
  const habitVer = c => (habitSub(c) || {}).rev || 0;
  function habitOf(c){
    const sub = habitSub(c); if (sub) return sub.data;
    if (c.habit && c.habit.fmt) return {};
    const l = c.life || {};
    return { call: l.call || '', langOther: l.lang || '', routineNote: l.routine || '', likeAct: l.likes || '' };
  }
  const habitDraft = c => (c.habit && c.habit.data) ? c.habit.data : habitOf(c);
  const secFilledD = (d, sec) => sec.fields.some(f => filledVal(d[f.k]) || (f.type === 'adl' && filledVal(d[f.k.replace('adl_', 'adlN_')])));
  const secFilled = (c, sec) => secFilledD(habitDraft(c), sec);
  function habitStatus(c){
    const filled = HABIT_SECS.filter(sec => secFilled(c, sec)).length, h = c.habit || {};
    return { filled, total: HABIT_SECS.length, at: h.updatedAt || '', by: h.updatedBy || '', skipped: false };
  }
  const habitReqMissing = d => HABIT_REQ.filter(k => k === 'lang' ? !(filledVal(d.lang) || filledVal(d.langOther)) : !filledVal(d[k]));
  function habitFamState(c){
    const sub = habitSub(c), dr = habitDraft(c);
    if (!sub) return anyFilled(dr) && c.habit && c.habit.fmt ? '草稿' : (anyFilled(dr) ? '草稿' : '尚未填寫');
    if (c.habit && c.habit.fmt && digestOf(c.habit.data) !== digestOf(sub.data)) return '已提交（有修改尚未提交）';
    return '已提交';
  }
  /* 家屬第一階段待辦：還沒有正式提交 */
  const habitFamTodo = c => !!c && consentOk(c) && !c.closed && !habitSub(c);
  function habitLines(c){
    const h = habitOf(c), j = (...a) => a.filter(x => x && String(x).trim()).join('；');
    const langs = [].concat(h.lang || []).concat(h.langOther ? [h.langOther] : []);
    return {
      call: h.call || '',
      comm: j(langs.length ? '說' + langs.join('、') : '', h.hearing && h.hearing !== '不清楚' ? h.hearing : '', h.commNote),
      routine: j(h.wake ? h.wake + ' 起床' : '', h.nap && h.nap !== '不清楚' ? h.nap + (h.napNote ? '（' + h.napNote + '）' : '') : h.napNote, h.bedtime ? '睡前：' + h.bedtime : '', h.bowel ? '排便：' + h.bowel : '', h.night && h.night !== '不清楚' ? '夜間' + h.night + (h.nightNote ? '（' + h.nightNote + '）' : '') : h.nightNote, h.routineNote),
      adl: ADL_KEYS.map(([k, l]) => { const v = h['adl_' + k], n = h['adlN_' + k]; if (!v || v === '不清楚') return n ? `${l}：${n}` : ''; return `${l}：${v}${n ? '（' + n + '）' : ''}`; }).filter(Boolean).join('；'),
      prefs: j(h.likeFood ? '喜歡吃：' + h.likeFood : '', h.dislikeFood ? '不喜歡吃：' + h.dislikeFood : '', h.likeAct ? '喜歡：' + h.likeAct : '', h.dislikeEnv ? '不喜歡的聲音或環境：' + h.dislikeEnv : '', h.dislikeTouch ? '不喜歡的碰觸或照護方式：' + h.dislikeTouch : '', h.otherPref),
      soothe: j(h.anxious ? '容易焦慮：' + h.anxious : '', h.refuseWhy ? '拒絕照護可能原因：' + h.refuseWhy : '', h.soothe ? '有效安撫：' + h.soothe : '', h.interact ? '互動注意：' + h.interact : ''),
      famNote: j(h.famHealth ? '家屬所知健康問題：' + h.famHealth : '', (h.recent || []).length ? '近半年' + h.recent.join('、') + (h.recentNote ? '：' + h.recentNote : '') : h.recentNote, h.famWatch)
    };
  }
  /* 已確認的醫療資料：由新到舊找護理已核對版本的欄位 */
  function confirmedField(c, k){
    for (const it of caseItems(c.id)){
      const vs = it.versions || [];
      for (let n = vs.length - 1; n >= 0; n--){ const v = vs[n]; if (v.nurseOk && v.fields){ if (v.fields[k] != null && v.fields[k] !== '') return v.fields[k]; break; } }
    }
    return '';
  }
  /* 家屬提供與已確認資料不一致：不覆蓋，列為待確認資訊 */
  function cardDiffs(c){
    const h = habitOf(c), out = [], fam = String(h.famAllergy || '').trim(), conf = confirmedField(c, 'allergy');
    const none = x => /^(無|沒有|無已知過敏|不清楚|文件未記載)?$/.test(String(x || '').replace(/\s/g, ''));
    if (fam && !(none(fam) && (!conf || none(conf))) && !(conf && conf.replace(/\s/g, '').includes(fam.replace(/\s/g, '')))) out.push({ k: 'allergy', label: '過敏', fam, conf: conf || '（尚無已確認資料）' });
    return out;
  }
  const medSnap = c => Object.fromEntries(HR_MED.map(([k]) => [k, confirmedField(c, k) || '']));
  function habitChanges(c){
    const hr = c.habitReview; if (!hr || !hr.done) return { fam: [], med: [] };
    const now = habitOf(c), snap = hr.done.snap || {}, keys = [...new Set(Object.keys(now).concat(Object.keys(snap)))];
    const fam = keys.filter(k => hvStr(now[k]) !== hvStr(snap[k])).map(k => ({ k, label: uiT(HABIT_LABEL[k] || k), before: hvStr(snap[k]), after: hvStr(now[k]) }));
    const m = medSnap(c), m0 = hr.done.med || {};
    const med = HR_MED.filter(([k]) => (m[k] || '') !== (m0[k] || '')).map(([k, label]) => ({ k, label: '已確認醫療資料：' + label, before: m0[k] || '', after: m[k] || '' }));
    return { fam, med };
  }
  function habitState(c){
    if (!hasHabit(c)) return '尚未提交';
    const hr = c.habitReview;
    if (hr && hr.state === '有疑義') return '有疑義／待確認';
    if (hr && hr.done && hr.state === '審核完成'){ const ch = habitChanges(c); return ch.fam.length || ch.med.length ? '資料已變更，需重新確認' : '審核完成'; }
    /* 舊資料：護理已閱／待確認只是閱讀或註記，不視為審核完成 */
    if (hr && hr.state === '待確認') return '有疑義／待確認';
    return '待審核';
  }
  /* 家屬端的習慣卡標籤 [文字, 色調] */
  function habitFamLabel(c){
    const fs = habitFamState(c), hs = habitState(c);
    if (!habitSub(c)) return fs === '草稿' ? ['草稿（未提交）', 'warn'] : ['待填寫／未提交', 'bad'];
    if (hs === '審核完成') return fs === '已提交' ? ['審核完成', 'ok'] : ['審核完成（有修改尚未提交）', 'warn'];
    if (hs === '有疑義／待確認') return ['有疑義／待確認', 'warn'];
    if (hs === '資料已變更，需重新確認') return ['已重新提交，待護理確認', 'info'];
    return [fs === '已提交' ? '已提交，待護理初審' : '已提交（有修改尚未提交）', 'info'];
  }
  /* 習慣卡必要初審（habitGate）：最新提交版本已由護理審核完成 */
  const habitGate = c => !!(c.habitReview && c.habitReview.done) && c.habitReview.done.rev === habitVer(c) && habitState(c) === '審核完成';

  /* ---------- F11 摘要卡依據 ---------- */
  const confirmedDx = c => (c.diagnoses || []).filter(d => d.state === '已確認' && !d.superseded);
  const dxText = c => confirmedDx(c).length ? confirmedDx(c).map(d => d.std || d.raw).join('、') : confirmedField(c, 'dx');
  function docVersions(c){ return caseItems(c.id).filter(i => CARD_DOC_KEYS.includes(i.key)).map(i => { const vs = (i.versions || []).filter(v => v.nurseOk); return vs.length ? i.key + ':' + vs[vs.length - 1].v : ''; }).filter(Boolean).join(','); }
  const habitDigest = c => digestOf(habitOf(c));
  function cardBasis(c){
    const a = c.assessment || {}, hl = habitLines(c);
    return { tube: confirmedField(c, 'tube'), allergy: confirmedField(c, 'allergy'), meds: confirmedField(c, 'meds'), move: a.move || '',
      call: hl.call, lang: hasHabit(c) ? hl.comm : ((c.life || {}).lang || ''), routine: hasHabit(c) ? hl.routine : ((c.life || {}).routine || ''), likes: hasHabit(c) ? hl.prefs : ((c.life || {}).likes || ''),
      dx: dxText(c), wound: confirmedField(c, 'wound'), tubeCare: confirmedField(c, 'tubeCare'), woundCare: confirmedField(c, 'woundCare'), swallow: confirmedField(c, 'swallow'),
      habit: habitDigest(c), docv: docVersions(c) };
  }
  /* 只比對開放當時有記錄的依據（舊版摘要卡沒有的新依據不會誤判為變更） */
  function cardChanged(c){
    const card = c.card; if (!card || card.status !== '已開放' || !card.basis) return [];
    const now = cardBasis(c);
    const norm = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
    const openTs = card.ts || Date.parse(String(card.at || '').replace(/\//g, '-').replace(' ', 'T') + ':00') || 0;
    const NEED_NAME = { tubeCare: '管路照護資料', woundCare: '傷口照護資料', swallow: '吞嚥與飲食' };
    const needCh = (c.cardNeedChange || []).filter(x => x.ts >= openTs).map(x => NEED_NAME[x.key]);
    const hab = habitGate(c) ? [] : [(c.habitReview && c.habitReview.done) ? '生活與照護習慣卡（最新提交版本待護理確認）' : '生活與照護習慣卡（尚未完成必要初審）'];
    return [...new Set(Object.keys(now).filter(k => k in card.basis && norm(now[k]) !== norm(card.basis[k])).map(k => BASIS_NAME[k]).concat(needCh, hab))];
  }
  /* 病摘逐筆診斷已確認，但診斷清單尚未同步（同步前摘要卡不能開放） */
  function dxPending(c){
    if (!c) return null;
    const it = caseItems(c.id).find(i => i.key === 'summary'); if (!it) return null;
    const vs = (it.versions || []).filter(v => v.nurseOk), v = vs[vs.length - 1];
    if (!v || !v.dxRows || v.dxRows.absent) return null;
    const L = c.diagnoses || [], same = d => d.src && d.src.itemId === it.id;
    const missing = v.dxRows.rows.filter(r => r.state === '已確認' && !L.some(d => same(d) && d.src.v === v.v && d.src.row === r.n));
    const stale = L.filter(d => same(d) && d.src.v !== v.v && !d.superseded);
    return missing.length || stale.length ? { it, v, missing, stale } : null;
  }

  /* ---------- F0 案件狀態（HANDOFF 9.3） ---------- */
  const listMissing = c => (D.docKeys || []).filter(k => !D.items[c.id + '_' + k]);
  const listOk = c => !!c && (!c.docList || c.docList.status === '完成') && !listMissing(c).length;
  /* 文件是否齊全：入住契約不列入（契約只看行政的正式簽約紀錄） */
  const docItems = c => activeItems(c).filter(i => i.key !== 'contract');
  const docsReady = c => listOk(c) && docItems(c).every(i => isDone(i, c)) && !docItems(c).some(condPending);
  function phase(c){
    if (c.closed) return '已結案';
    if (c.linkStatus !== '已確認') return '待機構確認';
    if (consentState(c) === '未簽署' || consentState(c) === '代理權未通過') return '待同意';
    if (consentState(c) === '已撤回') return '已結案';
    if (consentState(c) === '待代理權核實') return '待代理權核實';
    const act = docItems(c), all = docsReady(c), todo = act.some(i => familyTodo(i, c)) || habitFamTodo(c), hg = habitGate(c);
    const a = c.assessment, more = a && a.result === '需補充';
    if (c.flowMode === '先審後簽'){
      if (!a || more){ if (all && hg) return '評估中'; return more ? '評估待補件' : (todo ? '待補件' : '文件審查中'); }
      if (COORD_RESULTS.includes(a.result)) return '待協調';
      if (a.result !== '收治') return a.result === '不收治' ? '已結案' : '評估中';
      if (!contractSigned(c)) return '已收治待簽約';
      if (!all) return todo ? '待補件' : '入住前文件審查';
    } else {
      if (!all || (!a && !hg)) return more ? '評估待補件' : (todo ? '待補件' : '文件審查中');
      if (!contractSigned(c)) return '待簽約';
      if (!a || more) return '入住前確認中';
      if (COORD_RESULTS.includes(a.result)) return '待協調';
      if (a.result !== '可入住') return '入住前確認中';
    }
    if (!c.card || c.card.status === '草稿') return '摘要卡審核中';
    if (c.card.status === '已停用') return '摘要卡已停用';
    if (cardChanged(c).length) return '摘要卡待重新審核';
    return '摘要卡已開放';
  }
  /* 家屬端狀態說法：待機構確認＝等行政電話確認 */
  const famPhase = c => phase(c) === '待機構確認' ? '待行政確認' : phase(c);
  /* E：護理分配狀態獨立於文件與收治流程狀態 */
  const assignState = c => !c || c.linkStatus !== '已確認' ? '尚未轉交' : c.nurseId ? '已分配' : (c.closed || c.archived) ? '未分配（已結案）' : '待分配';
  const canAssign = a => !!a && a.role === 'nurse' && a.status === '啟用' && a.canAssignNurse === true;

  /* ---------- 處理歷程（依各步驟實際記錄的時間；沒有時間的舊資料不顯示，不推測） ---------- */
  const whoText = id => !id ? '系統' : acct(id) ? `${ROLE_NAME[acct(id).role] || ROLE_NAME[acct(id).want] || ''}｜${accName(id)}` : id;
  function caseTimeline(c){
    const ev = [], add = (t, at, by, note, kind, ts) => { if (at && /^\d{4}\/\d{2}\/\d{2}/.test(String(at))) ev.push({ t, at: String(at), by: by || '', note: note || '', kind, ts: ts || 0 }); };
    add('入住申請已送出', c.createdAt, c.familyId, '', 'apply', c.createdTs);
    add('行政已確認', c.confirmedAt, c.confirmedBy, '', 'confirm', c.confirmedTs);
    add('已轉交護理部門', c.handoverAt, c.handoverBy, '', 'handover', c.handoverTs);
    (c.assignHist || []).forEach(h => add(h.from ? '承辦護理師已更換' : '護理案件已分配', h.at, h.by, `${h.from ? accName(h.from) + ' → ' : ''}${accName(h.to)}${h.reason ? '（' + h.reason + '）' : ''}`, 'assign', h.ts));
    (c.consentHistory || (c.consent ? [{ event: '簽署', at: c.consent.at, by: c.consent.by, signer: c.consent.signer }] : [])).forEach(h => add(h.event === '撤回' ? '資料授權已撤回' : '資料授權已完成', h.at, h.by, h.signer ? '簽署人：' + h.signer : '', 'consent', h.ts));
    caseItems(c.id).forEach(i => {
      const nm = i.name;
      (i.versions || []).forEach(v => {
        add(v.provider === '機構' ? '機構文件已登錄' : v.supp ? '護理補充評估' : '文件已上傳', v.at, v.by, `${nm}（第 ${v.v} 版${v.fromItem ? '，沿用已上傳的檔案' : ''}）`, 'upload', v.ts);
        if (v.idCheck && !v.supp && v.provider !== '機構') add('行政收件已確認', v.idCheck.at, v.idCheck.by, nm, 'receipt', v.idCheck.ts);
        if (v.dateAt) add('文件日期已確認', v.dateAt, v.dateBy, `${nm}：${slash(v.dateConfirmed)}`, 'date');
        if (v.nurseOk && !v.supp) add('護理內容已核對', v.nurseAt, v.nurseBy, nm, 'review', v.nurseTs);
      });
      (i.needHist || []).forEach(h => add('文件需求判斷', h.at, h.by, `${nm}：${h.from} → ${h.to}`, 'need', h.ts));
      /* 處理歷程只列正式補件；舊版提醒留下的紀錄不當成補件要求 */
      const reqs = (i.reqHistory || []).concat(i.req ? [i.req] : []).filter(formalReqObj);
      reqs.forEach(r => { add('補件要求', r.at, r.by, `${nm}：${r.reason}${r.due ? '（期限 ' + slash(r.due) + '）' : ''}${r.auto ? '（系統依護理判斷自動建立）' : ''}`, 'req', r.ts); if (r.uploadedAt) add('已補傳', r.uploadedAt, c.familyId, nm, 'req2', r.uploadedTs); if (r.closedAt) add('補件完成', r.closedAt, r.closedBy || '', nm + (r.closedReason ? '（' + r.closedReason + '）' : '（文件已確認符合）'), 'req3', r.closedTs); });
    });
    (c.assessHistory || []).concat(c.assessment ? [c.assessment] : []).forEach(a => add((a.mode || c.flowMode) === '先簽後審' ? '入住前護理確認結果' : '收治評估結果', a.at, a.by, a.result, 'assess', a.ts));
    if (contractSigned(c)) add('正式簽約已記錄', c.signedAt, c.signedBy, '', 'sign', c.signedTs);
    add('入住前文件確認完成', c.preDocsDoneAt, '', '', 'predocs', c.preDocsTs);
    (c.cardHistory || []).concat(c.card && c.card.at && c.card.status !== '草稿' ? [c.card] : []).forEach(k => add(`照護摘要卡第 ${k.v} 版已開放`, k.at, k.by, '', 'card', k.ts));
    if (c.habitReview) (c.habitReview.hist || [c.habitReview]).forEach(h => add(h.state === '審核完成' ? '習慣卡審核完成' : h.state === '護理已閱' ? '習慣卡護理已閱' : '習慣卡初審：' + h.state, h.at, h.by, h.note || h.state, 'habit'));
    if (c.closed) add('案件已結案', c.closed.at, c.closed.by || '', c.closed.title, 'close');
    const rank = (c.flowMode === '先簽後審' ? ['apply', 'confirm', 'handover', 'assign', 'consent', 'upload', 'receipt', 'date', 'need', 'req', 'req2', 'review', 'req3', 'sign', 'predocs', 'assess', 'card', 'habit', 'close'] : ['apply', 'confirm', 'handover', 'assign', 'consent', 'upload', 'receipt', 'date', 'need', 'req', 'req2', 'review', 'req3', 'assess', 'sign', 'predocs', 'card', 'habit', 'close']);
    return ev.sort((a, b) => a.at.localeCompare(b.at) || ((a.ts && b.ts) ? a.ts - b.ts : rank.indexOf(a.kind) - rank.indexOf(b.kind)));
  }
  const lastAt = c => caseTimeline(c).reduce((m, e) => e.at > m ? e.at : m, c.createdAt || '');

  /* ---------- 家屬端進度條（HANDOFF 9.3：每一步顯示實際完成日期；沒有紀錄顯示「日期未記錄」） ---------- */
  function familyStep(c){
    const p = phase(c);
    if (p === '待同意' || p === '待機構確認' || p === '待代理權核實') return 0;
    if (['待補件', '文件審查中', '評估待補件'].includes(p)) return activeItems(c).some(i => familyTodo(i, c)) ? 1 : 2;
    if (p === '評估中') return 2;
    if (p === '已收治待簽約' || p === '待簽約') return 3;
    if (['入住前確認中', '待協調'].includes(p)) return c.flowMode === '先簽後審' ? 4 : 2;
    return 4;
  }
  const dOnly = at => at ? String(at).slice(0, 10) : '';
  const maxAt = arr => arr.includes(null) ? null : arr.reduce((m, x) => x > m ? x : m, '');
  const famReqDocs = c => caseItems(c.id).filter(i => i.key !== 'contract' && !instDoc(i) && !notApplicable(i) && isNeeded(i) && !condPending(i) && (c.flowMode === '先簽後審' || i.stage === '評估前'));
  const itemSubmitted = (i, c) => !!cur(i) && !['未上傳', '需補件', '確認過期'].includes(status(i, c));
  const itemDoneAt = i => { const v = cur(i); if (!v) return null; const t = [v.idCheck && v.idCheck.at, v.dateAt, v.nurseAt].filter(Boolean); return t.length ? t.sort().slice(-1)[0] : null; };
  const habitFirstDone = c => { const h = ((c.habitReview || {}).hist || []).find(x => x.state === '審核完成'); return h ? h.at : ((c.habitReview || {}).done || {}).at || null; };
  function stepsInfo(c){
    const S = (name, state, at, note) => ({ name, state, date: state === '已完成' ? (at ? dOnly(at) : '日期未記錄') : '', note: note || '' });
    const cs = consentState(c), ok = consentOk(c), k = c.consent || {}, out = [];
    out.push(cs === '有效' ? S('資料授權', '已完成', k.validAt || (k.signer === '本人' || !k.needsProof ? k.at : (k.proofCheck && k.proofCheck.at)) || null)
      : cs === '待代理權核實' ? S('資料授權', '進行中', '', '待代理權核實') : cs === '代理權未通過' ? S('資料授權', '需重新處理', '', '代理權未通過，需重新簽署')
        : cs === '已撤回' ? S('資料授權', '需重新處理', '', '已撤回') : S('資料授權', c.linkStatus === '已確認' ? '進行中' : '尚未開始'));
    const req = ok ? famReqDocs(c) : [], bad = req.filter(i => ['需補件', '確認過期'].includes(status(i, c))), sub = habitSub(c);
    const s2done = ok && !bad.length && req.every(i => itemSubmitted(i, c)) && !!sub;
    out.push(!ok ? S('上傳文件', '尚未開始') : bad.length ? S('上傳文件', '需重新處理', '', `${bad.length} 項需要重新上傳`)
      : s2done ? S('上傳文件', '已完成', maxAt(req.map(i => cur(i).at || null).concat([sub.at || null])))
        : S('上傳文件', '進行中', '', `還有 ${req.filter(i => !itemSubmitted(i, c)).length + (sub ? 0 : 1)} 項待提交${sub ? '' : '（含生活與照護習慣卡）'}`));
    /* 已完成評估的案件，機構審查保留歷史完成；尚未評估的案件，要求最新版習慣卡已完成初審 */
    const s3done = s2done && req.every(i => isDone(i, c)) && (c.assessment ? !!(c.habitReview && c.habitReview.done) : habitGate(c));
    const hs = habitState(c);
    out.push(!ok || (!s2done && !req.some(i => cur(i)) && !sub) ? S('機構審查', '尚未開始') : bad.length ? S('機構審查', '需重新處理', '', '有文件需要補件')
      : s3done ? S('機構審查', '已完成', maxAt(req.map(itemDoneAt).concat([habitFirstDone(c)])), hs === '資料已變更，需重新確認' ? '習慣卡有更新，護理重新確認中' : '')
        : S('機構審查', '進行中', '', hs === '有疑義／待確認' ? '習慣卡有疑義待確認' : ''));
    const a = c.assessment;
    if (c.flowMode === '先簽後審'){
      out.push(contractSigned(c) ? S('參訪簽約', '已完成', c.signedAt || null) : s3done ? S('參訪簽約', '進行中') : S('參訪簽約', '尚未開始'));
    } else {
      out.push(!a ? S('評估結果', s3done ? '進行中' : '尚未開始') : a.result === '收治' ? S('評估結果', '已完成', a.at || null, '收治')
        : a.result === '需補充' ? S('評估結果', '需重新處理', '', '需補充資料') : a.result === '不收治' ? S('評估結果', '已完成', a.at || null, '不收治')
          : S('評估結果', '進行中', '', a.result));
    }
    const card = c.card, p = phase(c), prev4 = out[3].state === '已完成' && (c.flowMode === '先簽後審' || (a && a.result === '收治'));
    out.push(card && card.status === '已開放' && !cardChanged(c).length ? S('入住準備', '已完成', card.at || null)
      : ['摘要卡待重新審核', '摘要卡已停用'].includes(p) ? S('入住準備', '需重新處理', '', p === '摘要卡已停用' ? '照顧摘要暫停使用' : '資料更新，護理重新確認中')
        : c.flowMode === '先簽後審' && a && a.result === '需補充' ? S('入住準備', '需重新處理', '', '需補充資料')
          : prev4 ? S('入住準備', '進行中', '', c.flowMode === '先簽後審' && a && COORD_RESULTS.includes(a.result) ? a.result : '') : S('入住準備', '尚未開始'));
    return out;
  }

  /* ---------- 工作清單（HANDOFF 10.9） ---------- */
  const myFamilyCases = () => Object.values(D.cases).filter(c => c.familyId === me.id).sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0));
  /* 待辦：每一筆 {kind?, c, tag, tone, what, why, btn, go:[原型畫面, 參數]}。go 由頁面轉成新版網址 */
  function tasks(){
    const t = [], role = me.role;
    const cases = Object.values(D.cases).filter(c => !c.closed);
    if (role === 'staff'){
      cases.forEach(c => {
        if (c.linkStatus === '待確認') t.push({ kind: 'apply', c, tag: '新申請', tone: 'warn', what: `確認新申請：${c.patient.name}`, why: `申請人 ${accName(c.familyId)}（${c.relation}），請電話確認身分與關係`, btn: '確認申請', go: ['apply', c.id] });
        if (c.linkStatus !== '已確認') return;
        if (c.linkStatus === '已確認' && !listOk(c)) t.push({ c, tag: '清單', tone: 'bad', what: `文件清單建立未完成：${c.patient.name}`, why: c.docList && c.docList.lastError ? `上次在「${c.docList.lastError.name}」失敗，請重新建立` : '請到案件頁重新建立文件清單', btn: '處理', go: ['case', c.id] });
        if (consentState(c) === '待代理權核實'){ const pi = proofItemOf(c), st = pi ? status(pi, c) : ''; t.push({ c, tag: '代理權', tone: 'warn', what: `核實代理權：${c.patient.name}`, why: pi ? `${pi.name}：${st}。核實前授權不生效` : '尚未建立證明文件項目', btn: '處理', go: ['case', c.id] }); if (pi && ['待收件', '身分待確認'].includes(st)) t.push({ c, tag: '收件', tone: 'info', what: `收件核對：${c.patient.name}｜${pi.name}`, why: '代理權證明，核對後才能確認授權', btn: '開始核對', go: ['receipt', pi.id] }); }
        if (c.flowMode === '先簽後審' && !contractSigned(c) && consentOk(c)) t.push({ c, tag: '簽約', tone: 'warn', what: `記錄入住契約：${c.patient.name}`, why: '先簽後審：家屬完成參訪與簽約後請記錄，護理才能做入住前確認', btn: '記錄', go: ['case', c.id] });
        if (!canProcess(c)) return;
        caseItems(c.id).forEach(i => {
          const s = status(i, c);
          if (nurseCond(i) && isNeeded(i) && !cur(i) && activeStages(c).includes(i.stage) && !(formalReq(i) && !i.req.closedAt)) t.push({ c, tag: '通知', tone: 'warn', what: `護理判定需要：${c.patient.name}｜${i.name}`, why: `${accName(i.needSetBy)} 判斷需要（${i.needNote || '未填依據'}）。系統沒有成功建立自動補件要求，請在案件頁用「要求補件」通知家屬並追蹤`, btn: '處理', go: ['case', c.id] });
          if (condPending(i) && !nurseCond(i) && activeStages(c).includes(i.stage)) t.push({ c, tag: '要求', tone: 'warn', what: `判斷是否需要：${c.patient.name}｜${i.name}`, why: `視情況繳交，尚未確認：${i.cond || '依個案狀況'}。確認前文件不算齊全，也不會列為家屬缺件`, btn: '判斷', go: ['case', c.id] });
          if (s === '待收件') t.push({ c, tag: '收件', tone: 'info', what: `收件核對：${c.patient.name}｜${i.name}`, why: '確認文件是住民本人的資料', btn: '開始核對', go: ['receipt', i.id] });
          if (s === '身分待確認') t.push({ c, tag: '身分', tone: 'bad', what: `身分待確認：${c.patient.name}｜${i.name}`, why: '先前標示身分有疑義，釐清後再核對', btn: '重新核對', go: ['receipt', i.id] });
          if (s === '疑似過期' || s === '初步符合') t.push({ c, tag: '日期', tone: s === '疑似過期' ? 'warn' : 'info', what: `核對日期：${c.patient.name}｜${i.name}`, why: s === '初步符合' ? '系統初步判斷在期限內，仍需您確認文件上的日期' : '日期可能已過期或尚未提供，只需確認文件上的日期', btn: '核對日期', go: ['date', i.id] });
        });
        if (phase(c) === '已收治待簽約') t.push({ c, tag: '簽約', tone: 'ok', what: `記錄簽約結果：${c.patient.name}`, why: '護理已評估可收治，家屬簽約後請記錄', btn: '記錄', go: ['case', c.id] });
        if (phase(c) === '待協調') t.push({ c, tag: '協調', tone: 'warn', what: `協調入住安排：${c.patient.name}`, why: (c.assessment || {}).result === '不符合收治條件' ? '已簽約但不符合收治條件，請協調並通知結果' : '護理評估需要協調，請和家屬討論後記錄結果', btn: '記錄結果', go: ['case', c.id] });
        if (c.consent){ const od = activeItems(c).filter(i => familyTodo(i, c) && overdue(i, c)); if (od.length) t.push({ c, tag: '逾期', tone: 'bad', what: `補件逾期：${c.patient.name}｜${od.map(i => i.name).join('、')}`, why: '已超過補件期限，請聯絡家屬或再次提醒', btn: '補件追蹤', go: ['followup', ''] }); }
      });
    }
    if (role === 'nurse'){
      cases.filter(c => c.nurseId === me.id && canProcess(c)).forEach(c => {
        const pend = caseItems(c.id).filter(i => nurseCond(i) && condPending(i) && !needAskOpen(i));
        if (pend.length) t.push({ c, tag: '需求', tone: 'warn', what: `照護文件需求確認：${c.patient.name}`, why: `${pend.map(i => i.name).join('、')}尚待確認是否需要。可以先依家屬提供的狀況與已上傳的文件判斷，不用等文件齊全`, btn: '確認', go: ['resident', c.id] });
        caseItems(c.id).filter(i => nurseCond(i) && needAskOpen(i)).forEach(i => t.push({ c, tag: '需求', tone: 'warn', what: `行政請您重新判斷：${c.patient.name}｜${i.name}`, why: `${accName(i.needAsk.by)}：${i.needAsk.note}（目前：${needText(i)}）`, btn: '判斷', go: ['resident', c.id] }));
        caseItems(c.id).forEach(i => { if (status(i, c) === '待護理核對') t.push({ c, tag: '核對', tone: 'info', what: `文件核對：${c.patient.name}｜${i.name}`, why: '對照原始文件，確認或輸入文件內容', btn: '開始核對', go: ['review', i.id] }); });
        const p = phase(c);
        { const hs = habitState(c); if (['待審核', '有疑義／待確認', '資料已變更，需重新確認'].includes(hs)) t.push({ c, tag: '習慣卡', tone: hs === '有疑義／待確認' ? 'bad' : 'warn', what: `生活與照護習慣卡初審：${c.patient.name}`, why: hs === '資料已變更，需重新確認' ? '家屬重新提交，只需確認變更的項目' : hs === '有疑義／待確認' ? '有疑義尚未處理，完成前不算必要資料審核完成' : '家屬已正式提交，第一階段必要資料，初審完成才能開始收治評估', btn: '開始初審', go: ['resident', c.id] }); }
        if (p === '評估中') t.push({ c, tag: '評估', tone: 'info', what: `收治評估：${c.patient.name}`, why: c.assessment && c.assessment.result === '需補充' ? '指定的補件已全部確認，請重新評估' : '評估前文件已全部確認', btn: '開始評估', go: ['assess', c.id] });
        if (c.card && c.card.status === '已開放' && cardChanged(c).length && !c.cardDraft) t.push({ c, tag: '摘要卡', tone: 'warn', what: `摘要卡需要重新審核：${c.patient.name}`, why: `已確認資料有變更：${cardChanged(c).join('、')}`, btn: '更新', go: ['resident', c.id] });
        if (c.cardDraft) t.push({ c, tag: '摘要卡', tone: 'info', what: `審核摘要卡修訂：${c.patient.name}`, why: `第 ${c.cardDraft.v} 版草稿，開放後取代目前版本`, btn: '審核', go: ['card', c.id] });
        if (p === '入住前確認中') t.push({ c, tag: '評估', tone: 'info', what: `入住前護理確認：${c.patient.name}`, why: c.assessment && c.assessment.result === '需補充' ? '指定的補件已全部確認，請重新確認' : '已簽約且文件已全部確認，請確認需要準備的照護資源', btn: '開始確認', go: ['assess', c.id] });
        if (dxPending(c)) t.push({ c, tag: '診斷', tone: 'bad', what: `診斷同步未完成：${c.patient.name}`, why: '病摘逐筆診斷已核對，但個案診斷清單尚未同步；同步完成前摘要卡不能開放', btn: '處理', go: ['resident', c.id] });
        else if (p === '摘要卡審核中') t.push({ c, tag: '摘要卡', tone: 'info', what: `審核照顧摘要卡：${c.patient.name}`, why: '系統已產生草稿，確認後開放給照服員', btn: '審核', go: ['card', c.id] });
      });
    }
    if (role === 'admin') Object.values(D.accounts).filter(a => a.status === '待審核').forEach(a => t.push({ what: a.name }));
    return t;
  }
  /* 已完成的工作：從處理歷程整理；已封存案件不列入 */
  const doneKind = (e, c) => { const nurse = me.role === 'nurse', kinds = nurse ? NURSE_KINDS : STAFF_KINDS, a = acct(e.by);
    if (!kinds.includes(e.kind) || !a || a.role !== (nurse ? 'nurse' : 'staff') || (nurse && e.by !== me.id)) return false;
    return !(e.kind === 'upload' && e.t !== '護理補充評估'); };
  function doneWork(){
    const out = [];
    Object.values(D.cases).filter(c => !c.archived).forEach(c => caseTimeline(c).forEach(e => { if (doneKind(e, c)) out.push(Object.assign({ c }, e)); }));
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  }
  const doneOf = c => caseTimeline(c).filter(e => doneKind(e, c)).sort((a, b) => b.at.localeCompare(a.at));
  /* 正在等待其他角色處理（只顯示，不算成自己的待辦） */
  function waitingOthers(c){
    const out = [], its = activeItems(c), nurse = me.role === 'nurse';
    if (c.linkStatus !== '已確認') return out;
    if (!canProcess(c)){ if (consentState(c) === '未簽署' || consentState(c) === '代理權未通過') out.push('等家屬簽署個人資料同意書'); if (consentState(c) === '待代理權核實') out.push(nurse ? '等行政核實代理權（核實前授權不生效）' : '等家屬上傳代理權證明或等您核實'); return out; }
    const famN = its.filter(i => familyTodo(i, c)).length;
    if (consentState(c) === '未簽署' && c.linkStatus === '已確認') out.push('等家屬簽署個人資料同意書');
    if (consentState(c) === '待代理權核實' && nurse) out.push('等行政核實代理權（核實前授權不生效）');
    if (famN) out.push(`等家屬上傳或補件：${famN} 項`);
    if (habitFamTodo(c)) out.push('等家屬正式提交生活與照護習慣卡（必填）');
    else if (!nurse && !c.assessment && !habitGate(c)) out.push('等護理完成生活與照護習慣卡初審');
    const condN = its.filter(i => nurseCond(i) && condPending(i)).length;
    if (!nurse){
      if (assignState(c) === '待分配' && c.linkStatus === '已確認') out.push('等護理主管分配承辦護理師');
      const rv = its.filter(i => status(i, c) === '待護理核對').length; if (rv) out.push(`等護理核對文件：${rv} 項`);
      if (condN) out.push(`等護理判斷是否需要：${condN} 項（待護理判斷，不算家屬缺件）`);
      const p = phase(c); if (['評估中', '入住前確認中'].includes(p)) out.push('等護理評估'); if (p === '摘要卡審核中') out.push('等護理審核照顧摘要卡');
    } else {
      const rc = its.filter(i => ['待收件', '身分待確認', '疑似過期', '初步符合'].includes(status(i, c))).length; if (rc) out.push(`等行政收件或核對日期：${rc} 項`);
      if (c.flowMode === '先簽後審' && !contractSigned(c)) out.push('等行政記錄入住契約（先簽後審）');
      if (phase(c) === '已收治待簽約') out.push('等行政記錄簽約結果'); if (phase(c) === '待協調') out.push('等行政協調入住安排');
    }
    return out;
  }
  function nextStage(c){
    const p = phase(c), later = caseItems(c.id).filter(i => !notApplicable(i) && !activeStages(c).includes(i.stage) && (isNeeded(i) || condPending(i)) && !instDoc(i));
    return { text: PHASE_NEXT[p] || '', later };
  }
  /* 補件追蹤（行政工作清單的「等家屬補件」磚） */
  function followupRows(){
    const rows = [];
    Object.values(D.cases).filter(canProcess).forEach(c => activeItems(c).filter(i => familyTodo(i, c) || ['開啟中', '已逾期'].includes(reqState(i, c))).forEach(i => { const fam = familyTodo(i, c); rows.push({ c, i, st: status(i, c), fam, due: dueOf(i, c), od: fam && overdue(i, c) }); }));
    return rows.sort((a, b) => (b.od - a.od) || String(a.due || '9').localeCompare(String(b.due || '9')));
  }
  /* 照服員：開放給自己的住民（已開放或已停用） */
  const myResidents = () => Object.values(D.cases).filter(c => !c.closed && c.card && ['已開放', '已停用'].includes(c.card.status) && (c.card.caregivers || []).includes(me.id));

  return {
    org, reqDays, keepDays, acct, accName, whoText,
    caseItems, cur, dueOf, overdue, consentState, proofItemOf, proofOnly, consentOk, contractSigned, canProcess, canProcessItem,
    aiDate, prelimDate, prelimSrc, itemDate, inValid, checks,
    needOf, condPending, isNeeded, notApplicable, tracked, nurseCond, needAskOpen, byNurse, needText, familyNeedText, instDoc, catOf, nurseCanSee,
    status, isDone, activeStages, activeItems, laterItems, familyTodo, needBy,
    formalReq, reqClosed, openFormalReq, reqCloseMissing, mailReqEvent, reqState, assessPassed,
    habitSub, hasHabit, habitVer, habitOf, habitDraft, habitStatus, habitReqMissing, habitFamState, habitFamTodo, habitLines, habitFamLabel,
    confirmedField, cardDiffs, medSnap, habitChanges, habitState, habitGate,
    confirmedDx, dxText, cardBasis, cardChanged, dxPending,
    listMissing, listOk, docItems, docsReady, phase, famPhase, assignState, canAssign,
    caseTimeline, lastAt, familyStep, stepsInfo,
    myFamilyCases, tasks, doneWork, doneOf, waitingOthers, nextStage, followupRows, myResidents
  };
}
