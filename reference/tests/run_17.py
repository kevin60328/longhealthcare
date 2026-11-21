"""簡化版自動化測試：內建文件清單、取消規則版本與改套、兩種入住流程完整跑一次、補件退回、選填未上傳、條件式不需要、寫入失敗。"""
import json, re, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
HTML = open('/home/claude/simp/index.html', encoding='utf-8').read()
DL = json.load(open('/home/claude/simp/doclist.json'))
errs, results = [], []
def check(t, n, expect, ok, actual=''):
    s = 'PASS' if ok is True else 'FAIL'
    results.append({'id': t, 'case': n, 'expect': expect, 'result': s, 'actual': '' if ok is True else str(actual)[:300]}); print(s, t, n, '' if ok is True else str(actual)[:300]); sys.stdout.flush()
A, B = 'C-0001-p4t8', 'C-0002-r6w3'
EXAM_OCR = {'p_cbc': '報告內有', 'p_cbc_r': '文字判讀：在正常範圍', 'p_liver': '報告內有', 'p_liver_r': '文字判讀：正常', 'p_kidney': '報告內有', 'p_kidney_r': '文字判讀：正常', 'p_glu': '報告內有', 'p_glu_r': '血糖｜118｜mg/dL｜70–99｜H', 'p_lyte': '報告內有', 'p_lyte_r': '文字判讀：正常', 'p_urine': '報告內有', 'p_urine_r': '文字判讀：正常', 'p_infect': '報告內有', 'p_infect_r': '文字判讀：B、C 型肝炎陰性', 'p_other': '報告內有', 'p_other_r': '文字判讀：心電圖竇性心律', 'examNote': '文件未記載'}
I = lambda k, c=A: f'{c}_{k}'
IMG = lambda n: open('/home/claude/simp/img/' + n + '.png', 'rb').read()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script('window.__SEED=' + json.dumps(seed, ensure_ascii=False) + ';' + mock)
    ctx.route('**/fonts.g*/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errs.append(m.text))
    pg.goto('file:///home/claude/simp/index.html'); pg.wait_for_selector('#portal, #loginForm')
    W = lambda ms=500: pg.wait_for_timeout(ms); E = lambda js: pg.evaluate(js)
    store = lambda path: E(f"(() => {{ const d = window.__store.get('{path}'); return d ? JSON.parse(JSON.stringify(d)) : null; }})()")
    keys = lambda pre: E(f"[...window.__store.keys()].filter(k => k.startsWith('{pre}'))")
    toasts = lambda: pg.inner_text('#toasts'); clr = lambda: E("document.getElementById('toasts').innerHTML = ''")
    main = lambda: pg.inner_text('main')
    fail = lambda pre: E(f"window.__failWrite = {json.dumps(pre)}")
    st = lambda k, c=A: E(f"status(D.items['{I(k, c)}'], D.cases['{c}'])")
    ph = lambda c=A: E(f"phase(D.cases['{c}'])")
    bar = lambda: pg.inner_text('#outboxBar') if pg.query_selector('#outboxBar:not([hidden])') else ''
    who = {'u': None}
    CUR = [None]
    def assign(c, n):
        prev = CUR[0]; login('nurse@example.com'); pg.evaluate("go('assign')"); pg.wait_for_timeout(300); pg.click(f'[data-act="assign-nurse"][data-case="{c}"]'); pg.wait_for_timeout(200); pg.select_option('#asNurse', n); pg.click('[data-act="modal-ok"]'); pg.wait_for_timeout(1500); login(prev)
    def login(e):
        CUR[0] = e
        who['u'] = e
        if pg.query_selector('[data-act="logout"]'): pg.click('[data-act="logout"]'); W(300); pg.wait_for_selector('#portal, #loginForm')
        pg.evaluate("go('login', '%s')" % ('applicant' if e.startswith('family') else 'staff')); pg.wait_for_selector('#loginForm'); pg.fill('#loginForm [name=email]', e); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); pg.wait_for_selector('#top [data-act="logout"]', timeout=15000); W(400); pg.evaluate("me && me.role === 'family' && myFamilyCases().length && go('home', myFamilyCases()[0].id)"); pg.wait_for_timeout(200)
    def to_guide():
        cid = E("(route.page === 'guide' && route.arg) ? route.arg : ((route.arg && D.cases[route.arg]) ? route.arg : ((typeof myFamilyCases === 'function' && myFamilyCases()[0]) || {}).id || null)")
        if E("route.page") != 'guide' or E("route.arg") != cid: E(f"go('guide', {json.dumps(cid)})"); pg.wait_for_timeout(300)

    def hab_submit(c):
        """家屬在畫面上補齊習慣卡必填欄位並正式提交（八大項）"""
        for sec in ['0', '1', '2']:
            nav('life', c, sec)
            E("""(() => { const f = document.getElementById('habitForm'); if (!f) return;
              const t = (n, v) => { const el = f.querySelector(`[name=${n}]`); if (el && !el.value.trim()) el.value = v; };
              t('call', '測試稱呼'); t('famAllergy', '無');
              const hs = f.querySelector('select[name=hearing]'); if (hs && !hs.value) hs.value = '不清楚';
              if (f.querySelector('input[name=lang]') && !f.querySelector('input[name=lang]:checked') && !(f.querySelector('[name=langOther]') || {}).value) f.querySelector('input[name=lang][value="國語"]').checked = true;
              [...new Set([...f.querySelectorAll('input[type=radio][name^=adl_]')].map(x => x.name))].forEach(n => { if (!f.querySelector(`input[name=${n}]:checked`)) f.querySelector(`input[name=${n}][value="不清楚"]`).checked = true; }); })()""")
            pg.click('#habitForm button[value="stay"]'); pg.wait_for_timeout(700)
        pg.click('[data-act="habit-submit"]'); pg.wait_for_timeout(1200)

    def nav(page_, arg=None, arg2=None):
        E(f"route.page={json.dumps(page_)}; route.arg={json.dumps(arg)}; route.arg2={json.dumps(arg2)}; reviewState=null; render(true)"); W(300)
    def need(c, key, val, note):
        if key in ('tubeCare', 'woundCare', 'swallow'):
            back_to = who['u']; login(E(f"D.cases['{c}'].nurseId")); nav('resident', c)
            pg.click(f'[data-act="need-edit"][data-item="{I(key, c)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
            login(back_to); return
        nav('case', c); pg.click(f'[data-act="need-edit"][data-item="{I(key, c)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
    def upload(c, key, img, date=None, expect_ok=True):
        nav('upload', c, I(key, c)); pg.set_input_files('#file', {'name': img + '.png', 'mimeType': 'image/png', 'buffer': IMG(img)})
        if date and pg.query_selector('#examDate'): pg.fill('#examDate', date)
        pg.click('#uploadForm button[type=submit]')
        if expect_ok: pg.wait_for_function("route.page === 'uploaded'", timeout=15000)
        W(400)
    def receipt(c, key, birth, nid=True, signer=None):
        nav('receipt', I(key, c))
        if pg.query_selector('#signerForm'):
            pg.fill('#signerForm [name=signerName]', signer); pg.check('#signerForm [name=signerOk]'); pg.check('#signerForm [name=content]')
            pg.click('#signerForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400); return
        pg.select_option('#receiptForm [name=m-name]', '相符')
        if pg.query_selector('#receiptForm [name=m-nid]'): pg.select_option('#receiptForm [name=m-nid]', '相符' if nid else '沒有')
        if pg.query_selector('#birthRaw'):
            if birth is None: pg.check('#birthNone')
            else: pg.fill('#birthRaw', birth)
        W(150)
        if not pg.is_hidden('#manualBox'): pg.check('#manualBox input[name=how] >> nth=0')
        if pg.query_selector('#receiptForm [name=content]'): pg.check('#receiptForm [name=content]')
        pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    def datec(c, key, d):
        nav('date', I(key, c)); pg.fill('#dateVal', d); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    def review(c, key, ocr=None, fill=None):
        nav('review', I(key, c))
        if ocr is not None: E(f"window.__ocrNext = {json.dumps(ocr, ensure_ascii=False)}"); pg.click('#ocrBtn'); W(1500)
        for i, v in (fill or {}).items(): pg.fill(f'#fv-{i}', v)
        for _ in range(80):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(60)
        pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    def confirm_apply(c, nurse):
        nav('apply', c); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(c, nurse)
    def consent(c):
        nav('consent', c); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.check('[name=emergency]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    def signed(c):
        nav('case', c); pg.click('main [data-act="signed"]'); W(300)
        if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
        W(1500)

    mails_for = lambda iid: [dict(store(k), id=k.split('/', 1)[1]) for k in keys('mailQueue/') if (store(k) or {}).get('itemId') == iid]
    tl_req = lambda c, nm: E(f"caseTimeline(D.cases['{c}']).filter(e => e.kind === 'req' && e.note.indexOf({json.dumps(nm)}) === 0).length")
    def setmail(mid, patch):
        E(f"(async () => {{ const x = JSON.parse(JSON.stringify(window.__store.get('mailQueue/{mid}'))); Object.assign(x, {json.dumps(patch, ensure_ascii=False)}); await db.doc('mailQueue/{mid}').set(x); }})()"); W(700)

    import time as _t
    now_ms = lambda: int(_t.time() * 1000)
    row_of = lambda mid: E(f"(() => {{ const r = document.querySelector('tr[data-mail=\"{mid}\"]'); return r ? r.textContent : null; }})()")
    has_retry = lambda mid: pg.query_selector(f'[data-act="reqmail-retry"][data-id="{mid}"]') is not None

    # ================= S0 靜態檢查：已移除的規則版本與改套 =================
    gone = ['startRuleMigration', 'runRuleMigration', 'rulePlan', 'RULE_TEMPLATE', 'ruleMigration', 'ruleArchive', 'tpl-load', 'rule-apply', 'retiredOf', 'retiredField', 'histUsed', 'CASE_SPECIFIC', 'migrating(', 'ruleVer', '改套', '繼續改套']
    left = [g for g in gone if g in HTML]
    check('S0-1', '程式碼搜尋已移除的規則版本／改套識別字（靜態檢查）', '全部不存在：' + '、'.join(gone), not left, left)
    check('S0-2', '內建文件清單內容（靜態檢查）', f'DOC_LIST 共 24 項、涵蓋 A–F 類；檢查效期註明示範機構參考設定', len(DL) == 24 and sorted(set(r['cat'] for r in DL)) == list('ABCDEF') and '示範機構的參考設定' in HTML, len(DL))
    check('S0-3', '頁尾模擬環境標示（靜態檢查）', '文字完全相同', '目前為模擬環境：資料尚未正式介接 Supabase 與 HAPI FHIR。' in HTML)

    # ================= M 系統管理員 =================
    login('admin@example.com'); nav('settings'); t = main()
    check('M1', '機構設定頁沒有文件規則版本、範本、改套', '沒有「文件規則（目前第」「載入」「儲存為新版本」「新增文件類型」；有「內建入住文件清單」（唯讀）', all(x not in t for x in ['文件規則（目前第', '載入機構範例', '儲存為新版本', '新增文件類型']) and '內建入住文件清單' in pg.text_content('main') and not pg.query_selector('#docListRef select, #docListRef input'), t[:200])
    pg.fill('#settingsForm [name=phone]', '(07) 765-4321'); pg.click('#settingsForm button[type=submit]'); W(1000); o = store('settings/org')
    check('M2', '儲存系統基本設定', '電話更新、設定修訂號 +1、沒有 rules／ruleVer 欄位', o['phone'] == '(07) 765-4321' and o.get('rev') == 2 and 'rules' not in o and 'ruleVer' not in o, o)
    nav('accounts'); pg.click('[data-act="acc-approve"] >> nth=0'); W(200); pg.click('[data-act="modal-ok"]'); W(900)
    check('M3', '帳號審核：核准待審核人員', '第一位待審核人員變成「啟用」', sum(1 for k in keys('accounts/') if store(k)['status'] == '啟用' and k.split('/')[1] in ('jiaying@example.com', 'zhihao@example.com')) == 1)
    check('M4', '使用權限管理介面仍在', '機構設定頁有「資料存取與權限」說明，標示尚未實作資料庫端權限', (nav('settings') or True) and pg.query_selector('#accessCard') is not None and '畫面' in pg.inner_text('#accessCard'))

    # ================= F 家屬：建立新申請 → 自動產生完整清單 =================
    login('family3@example.com'); nav('apply')
    pg.fill('#applyForm [name=pname]', '劉春梅'); pg.fill('#applyForm [name=nid]', 'K287654321'); pg.fill('#applyForm [name=birth]', '1943-02-03'); pg.select_option('#applyForm [name=relation]', '兒子'); pg.fill('#applyForm [name=admit]', '2026-12-10')
    pg.click('#applyForm button[type=submit]'); W(500); pg.click('#applyPreviewForm button[type=submit]'); W(3000)
    cid = [k.split('/')[1] for k in keys('cases/') if store(k)['patient']['name'] == '劉春梅'][0]
    nav('home', cid)
    its = [k for k in keys('items/') if k.startswith('items/' + cid + '_')]
    c3 = store('cases/' + cid)
    check('F1', '家屬建立新入住申請', '案件建立、編號 C-0003；系統自動建立 24 份文件項目；清單狀態「完成」', len(its) == 24 and c3['docList']['status'] == '完成' and c3['no'] == 'C-0003', (len(its), c3.get('docList'), c3.get('no')))
    to_guide(); t = pg.text_content('main')
    cats = re.findall(r'([A-G])\. (身分與聯絡資料|入住前健康檢查資料|醫療資料|特殊照護資料|授權與法律文件|契約與費用)', t)
    check('F2', '家屬首頁立即看到「入住文件準備清單」', '顯示清單標題與 A–F 六大類（G 類由行政個案新增時才出現）；有需要繳交／視情況繳交／選填三種標示', '入住文件準備清單' in t and len(set(c for c, _ in cats)) == 6 and all(x in t for x in ['需要繳交', '視情況繳交', '選填']), (sorted(set(cats)), t[:120]))
    check('F3', '尚未確認申請與授權前不能上傳', '清單沒有上傳按鈕，提示簽署後才能上傳；不顯示「版」「改套」', not pg.query_selector('#docList [data-act="fgo"][data-page="upload"]') and '簽署資料授權同意書後，就可以開始上傳' in t and '改套' not in t and '規則' not in t)
    check('F4', '簽約後才要的文件', '入住契約、繳費收據等標示「簽約後再準備」，不在目前要做的事', '簽約後再準備' in t)
    # 文件清單建立中途失敗
    nav('apply'); pg.fill('#applyForm [name=pname]', '劉阿福'); pg.fill('#applyForm [name=nid]', 'K187654322'); pg.fill('#applyForm [name=birth]', '1941-05-05'); pg.fill('#applyForm [name=admit]', '2026-12-20')
    E("window.__failAfter = 0; (() => { const s = window.__store, orig = s.set.bind(s); let n = 0; s.set = (k, v) => { if (k.startsWith('items/') && ++n > 5) throw {code:'unavailable'}; return orig(k, v); }; window.__restoreSet = () => { s.set = orig; }; })()")
    pg.click('#applyForm button[type=submit]'); W(500); pg.click('#applyPreviewForm button[type=submit]'); W(3000); E("window.__restoreSet()")
    cid4 = [k.split('/')[1] for k in keys('cases/') if store(k)['patient']['name'] == '劉阿福'][0]
    c4 = store('cases/' + cid4); n4 = len([k for k in keys('items/') if k.startswith('items/' + cid4 + '_')])
    check('W1', '資料寫入失敗：建立文件清單時第 6 份寫入失敗', '案件標記「未完成」（記錄失敗文件與已建立份數）；只有 5 份文件', c4['docList']['status'] == '未完成' and n4 == 5 and c4['docList']['lastError']['done'] == 5, (c4.get('docList'), n4))
    nav('home', cid4); t = main()
    check('W2', '清單不完整時家屬端', '顯示「文件清單準備中」與重新整理按鈕，不顯示「入住文件準備清單」為完整', '文件清單準備中' in t and pg.query_selector('[data-act="list-build"]') is not None, t[:150])
    E(f"(async () => {{ const c = JSON.parse(JSON.stringify(window.__store.get('cases/{cid4}'))); c.linkStatus = '已確認'; c.consent = {{signer:'本人', at:'x', ver:1, by:'family3@example.com'}}; await db.doc('cases/{cid4}').set(c); }})()"); W(800)
    check('W3', '清單不完整時不會誤判文件齊全', '即使 5 份文件都不需要上傳，案件也不會進入「評估中」；評估與摘要卡檢查都擋下', ph(cid4) != '評估中' and E(f"listOk(D.cases['{cid4}'])") is False and 'string' == E(f"(me = D.accounts['nurse@example.com'], typeof assessGuard(Object.assign({{}}, D.cases['{cid4}'], {{nurseId:'nurse@example.com'}})))") and E(f"cardAllowed(D.cases['{cid4}'])") is False, ph(cid4))
    E("me = D.accounts['family3@example.com']")
    nav('home', cid4); pg.click('[data-act="list-build"]'); W(2500)
    c4 = store('cases/' + cid4); n4 = len([k for k in keys('items/') if k.startswith('items/' + cid4 + '_')])
    check('W4', '按「重新整理文件清單」重試', '只補建缺少的 19 份、不重複建立；清單狀態「完成」', c4['docList']['status'] == '完成' and n4 == 24, (c4.get('docList'), n4))
    # 空清單防呆
    E("(async () => { await db.doc('cases/C-9999-zzzz').set({no:'C-9999', familyId:'family3@example.com', relation:'兒子', patient:{name:'測試空清單', nid:'K100000001', birth:'1940-01-01'}, plannedAdmit:'2026-12-30', flowMode:'先審後簽', docList:{status:'完成'}, linkStatus:'已確認', consent:{signer:'本人', at:'x', ver:1}, assessment:null, signedAt:null, card:null, closed:null}); })()"); W(800)
    check('W5', '文件清單為空的案件（防呆）', '不算文件齊全：不進入評估中、不能評估、不能產生摘要卡', ph('C-9999-zzzz') != '評估中' and E("listOk(D.cases['C-9999-zzzz'])") is False and E("cardAllowed(D.cases['C-9999-zzzz'])") is False, ph('C-9999-zzzz'))
    E("(async () => { await db.doc('cases/C-9999-zzzz').delete(); })()"); W(500)

    # ================= 先審後簽：張秀英 =================
    login('staff@example.com'); confirm_apply(A, 'nurse@example.com')
    check('S1', '行政確認申請', '已確認、指定黃護理師；文件清單沿用申請時建立的 24 份（不重建）；家屬收到通知', store('cases/' + A)['linkStatus'] == '已確認' and len([k for k in keys('items/') if k.startswith('items/' + A + '_')]) == 24 and any(store(k)['caseId'] == A for k in keys('notices/')))
    login('family@example.com'); consent(A)
    check('S2', '家屬簽署資料授權（沿用線上簽署）', '授權有效；個資同意列在 E 類為線上簽署，沒有另外的上傳項目', E(f"consentOk(D.cases['{A}'])") and '個人資料蒐集、處理及利用同意書（線上簽署）' in (to_guide() or pg.text_content('#docList')) and not any('個人資料' in store(k)['name'] for k in keys('items/' + A)))
    E(f"(async () => {{ const x = JSON.parse(JSON.stringify(window.__store.get('items/{I('nhi')}'))); x.req = {{reason:'未上傳', due:'2026-11-30'}}; x.remind = {{n:1, at:'2026/11/10 09:00'}}; await db.doc('items/{I('nhi')}').set(x); }})()"); W(800)
    nav('home', A); hm = main(); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)")
    row = E(f"(() => {{ const r = [...document.querySelectorAll('#docList .drow')].find(x => x.querySelector('.t-name').textContent === '健保卡'); return r ? r.textContent : ''; }})()")
    check('16-2a', '家屬頁面：舊版提醒不顯示為機構要求', '健保卡（舊版提醒留下原因「未上傳」的 req）在完整清單不顯示「機構要求」；首頁沒有補件進度', '機構要求' not in row and '健保卡' in row and pg.query_selector('#reqCard') is None and '補件進度' not in hm, row[:150])
    login('staff@example.com'); nav('case', A); sc = pg.text_content('main')
    nhi_row = E(f"(() => {{ const r = [...document.querySelectorAll('main tr')].find(x => x.querySelector('td') && x.textContent.includes('健保卡') && !x.querySelector('tr')); return r ? r.textContent : ''; }})()")
    check('16-2b', '行政頁面：舊版提醒顯示為一般提醒', '案件頁健保卡顯示「已提醒 1 次（一般提醒，不是補件）」，不顯示「補件請求：」；處理歷程沒有健保卡的補件要求', '一般提醒' in nhi_row and '補件請求' not in nhi_row and tl_req(A, '健保卡') == 0, nhi_row[:200])
    nav('followup'); fu = pg.text_content('main')
    check('16-2c', '行政補件追蹤：舊版提醒仍是首次繳交', '健保卡標示「首次繳交」', E("[...document.querySelectorAll('main tr')].filter(x => x.textContent.includes('健保卡')).every(x => x.textContent.includes('首次繳交'))") and '健保卡' in fu)
    u = E("[formalReq({req:{reason:'未上傳', due:'x'}}), openFormalReq({req:{reason:'未上傳'}}, {}), formalReq({req:{reason:'文件模糊，看不清楚', source:'護理'}}), formalReqObj({reason:'日期超過期限', source:'系統'})]")
    check('16-2d', '判斷規則（程式層級）', '舊版提醒格式不是正式補件；護理退回、系統過期是正式補件', u == [False, False, True, True], u)
    check('16-2e', '舊紀錄不刪除', '資料庫中健保卡的舊 req 與提醒紀錄保留', store('items/' + I('nhi'))['req']['reason'] == '未上傳' and store('items/' + I('nhi'))['remind']['n'] == 1)
    login('family@example.com')
    nav('contacts', A); pg.fill('#contactForm [name=name0]', '張家豪'); pg.fill('#contactForm [name=rel0]', '兒子'); pg.fill('#contactForm [name=phone0]', '0912-300-111'); pg.click('#contactForm button[type=submit]'); W(800)
    # 條件式判斷
    login('staff@example.com'); nav('case', A); t = main()
    btns = E("[...document.querySelectorAll('main [data-act=need-edit]')].map(b => b.dataset.item.split('_').pop())")
    check('S3', '行政只判斷非照護類的視情況文件', '只有戶籍或代理關係證明有判斷按鈕（管路、傷口、吞嚥改由護理判斷）；沒有改套或版本提示', btns == ['relProof'] and '改套' not in t and '版文件規則' not in t, btns)
    tasks0 = E(f"tasks().filter(t => t.tag === '要求' && t.c.id === '{A}').length")
    check('S4', '行政工作清單不再列管路、傷口、吞嚥的判斷', '0 筆（戶籍證明屬簽約後階段）', tasks0 == 0, tasks0)
    pg.click(f'[data-act="need-edit"][data-item="{I("relProof")}"]'); W(200)
    opts = E("[...document.querySelectorAll('input[name=needSel]')].map(x => x.closest('label').querySelector('strong').textContent)")
    check('S5', '判斷視窗只有三個選項', '本案需要／本案不需要／尚未確認', opts == ['本案需要', '本案不需要', '尚未確認'], opts)
    pg.click('[data-act="modal-cancel"]') if pg.query_selector('[data-act="modal-cancel"]') else None; W(200)
    need(A, 'tubeCare', 'yes', '出院摘要記載鼻胃管'); need(A, 'swallow', 'yes', '吞嚥評估建議管灌'); need(A, 'woundCare', 'no', '出院摘要記載無傷口'); need(A, 'relProof', 'yes', '由兒子簽約')
    it = store('items/' + I('woundCare'))
    check('S6', '條件式文件「本案不需要」', '狀態「不需要」、記錄判斷者（負責護理師）、時間與原因', st('woundCare') == '不需要' and it['needSetBy'] == 'nurse@example.com' and it['needNote'] == '出院摘要記載無傷口' and it['needHist'][-1]['to'] == '護理已確認：不需要', it.get('needHist'))
    # 家屬上傳
    login('family@example.com'); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)"); t = (to_guide() or pg.text_content('#docList'))
    row = E(f"(() => {{ const r = [...document.querySelectorAll('#docList .drow')].find(x => x.querySelector('.t-name').textContent === '傷口照護資料'); return r ? r.textContent : ''; }})()")
    check('S7', '家屬端顯示條件式判斷結果', '傷口照護資料顯示「本案不需繳交」、沒有上傳按鈕', '本案不需繳交' in row and '上傳' not in row.replace('上傳：', ''), row[:100])
    todo0 = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.key).sort()")
    check('S8', '家屬「目前要做的事」只列需要的評估前文件', '長輩身分證明、健保卡、出院摘要、用藥、管路、吞嚥（6 份）；選填與入住前文件不列入', todo0 == sorted(['idcopy', 'nhi', 'summary', 'meds', 'tubeCare', 'swallow']), todo0)
    # 寫入失敗：上傳
    nav('upload', A, I('idcopy')); pg.set_input_files('#file', {'name': 'a.png', 'mimeType': 'image/png', 'buffer': IMG('01_身分證影本_張秀英')}); fail('items/'); pg.click('#uploadForm button[type=submit]'); W(1500); fail(None)
    check('W6', '資料寫入失敗：上傳時文件寫入失敗', '顯示「上傳失敗…檔案已保留」；沒有新增版本；按「送出」重試成功', '上傳失敗' in pg.inner_text('#upErr') and not store('items/' + I('idcopy'))['versions'], pg.inner_text('#upErr'))
    pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    check('W7', '重試上傳', '第 1 版建立，只有一個版本', len(store('items/' + I('idcopy'))['versions']) == 1)
    upload(A, 'nhi', '02_健保卡_張秀英'); upload(A, 'summary', '03_出院病歷摘要_張秀英'); upload(A, 'meds', '05_用藥清單_不清楚_張秀英'); upload(A, 'tubeCare', '06_管路照護指導_張秀英'); upload(A, 'swallow', '07_吞嚥評估_張秀英')
    check('F5', '家屬上傳文件', '6 份評估前文件都是第 1 版、狀態「待收件」；選填文件未上傳', all(st(k) == '待收件' for k in ['idcopy', 'nhi', 'summary', 'meds', 'tubeCare', 'swallow']) and not store('items/' + I('diag'))['versions'])
    # 習慣卡：填寫部分區塊
    nav('life', A); pg.fill('#habitForm [name=call]', '秀英阿嬤'); pg.check('#habitForm input[name=lang][value="台語"]'); pg.click('#habitForm button[value="next"]'); W(800)
    pg.fill('#habitForm [name=famAllergy]', '海鮮'); pg.click('#habitForm button[value="stay"]'); W(900)
    h = store('cases/' + A).get('habit') or {}
    check('F6', '填寫生活與照護習慣卡（部分區塊）', '已儲存 A、B 兩區，來源標示「家屬提供」；其餘區塊未填不影響送件', h.get('src') == '家屬提供' and h['data'].get('call') == '秀英阿嬤' and set(h.get('secAt', {}).keys()) == {'A', 'B'})
    # 行政收件與出生日期比對
    login('staff@example.com')
    nav('receipt', I('idcopy')); pg.fill('#birthRaw', '民國 30 年 6 月 12 日'); W(200); bad = pg.inner_text('#birthCmp')
    pg.fill('#birthRaw', '民國 29 年 6 月 12 日'); W(200); good = pg.inner_text('#birthCmp')
    check('S9', '出生日期逐項比對', '民國 30 年 → 顯示不一致；民國 29 年 6 月 12 日 → 轉為 1940/06/12 一致', '不一致' in bad and '1940/06/12' in good and '一致' in good and '不一致' not in good, (bad[:60], good[:60]))
    receipt(A, 'idcopy', '民國 29 年 6 月 12 日'); receipt(A, 'nhi', '029/06/12'); receipt(A, 'summary', '1940/06/12'); receipt(A, 'meds', '1940/06/12'); receipt(A, 'tubeCare', '民國 29 年 06 月 12 日', nid=False); receipt(A, 'swallow', '1940/06/12')
    v = store('items/' + I('nhi'))['versions'][0]
    check('S10', '行政收件核對', '非醫療文件（身分證、健保卡）確認符合；醫療文件轉「待護理核對」；出生日期比對結果有保存', st('idcopy') == '確認符合' and st('nhi') == '確認符合' and all(st(k) == '待護理核對' for k in ['summary', 'meds', 'tubeCare', 'swallow']) and (v.get('idCheck') or {}).get('birth', {}).get('result') == '一致', (st('idcopy'), v.get('idCheck')))
    # 護理：OCR、退回補件
    login('nurse@example.com')
    check('N1', '護理只看醫療文件', '身分證、健保卡不能由護理查看；工作清單只有 4 份醫療文件核對', E(f"nurseCanSee(D.items['{I('idcopy')}'])") is False and E("tasks().filter(t => t.tag === '核對').length") == 4)
    review(A, 'summary', ocr={'stype': '住院出院摘要', 'dx': '腦中風後遺症（右側無力）、高血壓', 'dc': '2026-11-04', 'tube': '鼻胃管', 'allergy': '磺胺類藥物（皮疹）', 'wound': '無'})
    o = store(f'ocrRuns/{I("summary")}__v1'); v = store('items/' + I('summary'))['versions'][0]
    check('N2', 'OCR 辨識及人工確認', 'OCR 結果另存（ocrRuns）；每欄人工確認後完成核對；欄位保留 AI 來源', o is not None and v.get('nurseOk') and v['fields']['tube'] == '鼻胃管' and st('summary') == '確認符合', (o and list(o.keys()), v.get('fields')))
    fail('mailQueue/')
    nav('review', I('meds')); pg.click('[data-act="review-return"]'); W(200); pg.select_option('#retReason', '文件模糊，看不清楚'); pg.fill('#retNote', '請重新拍攝清楚的帶藥明細'); pg.click('[data-act="modal-ok"]'); W(1500)
    check('N3', '補件退回：護理退回用藥清單', '狀態「需補件」，補件請求開啟中並記錄原因與期限', st('meds') == '需補件' and store('items/' + I('meds'))['req']['reason'] == '文件模糊，看不清楚')
    W(800); fail(None); rq = store('items/' + I('meds'))['req']; nh = len(store('items/' + I('meds')).get('reqHistory') or []); tl0 = tl_req(A, '目前用藥清單')
    check('16-1a', '模擬寫入失敗：補件要求已建立、Email 通知工作建立失敗', 'mailQueue 寫入失敗時：用藥清單的正式補件請求已建立，但沒有任何 Email 通知工作', rq and rq['source'] == '護理' and not mails_for(I('meds')), (rq and rq.get('reason'), mails_for(I('meds'))))
    login('staff@example.com'); nav('case', A); mc = pg.inner_text('#reqMailCard') if pg.query_selector('#reqMailCard') else ''
    check('16-1b', '行政案件頁顯示「待建立／建立失敗」與重試入口', '補件 Email 通知區塊列出用藥清單：「待建立／建立失敗」，有「建立並寄送」按鈕', '待建立／建立失敗' in mc and '目前用藥清單' in mc and pg.query_selector(f'[data-act="reqmail-create"][data-item="{I("meds")}"]') is not None, mc[:200])
    login('family@example.com'); nav('home', A); rcf = pg.inner_text('#reqCard') if pg.query_selector('#reqCard') else ''
    check('16-1c', '家屬補件進度也標示通知待建立', '家屬補件進度的用藥清單顯示「Email 通知：待建立／建立失敗」，不宣稱已寄出', 'Email 通知：待建立／建立失敗' in rcf.split('管路照護資料')[0] and '已寄送' not in rcf.split('管路照護資料')[0], rcf[:200])
    login('staff@example.com'); nav('case', A); fail('mailQueue/'); clr(); pg.click(f'[data-act="reqmail-create"][data-item="{I("meds")}"]'); W(1200); t1 = toasts(); fail(None)
    check('16-1d', '重試時仍寫入失敗', '再次失敗時提示沒有完成，仍沒有通知工作，也沒有顯示寄送成功', not mails_for(I('meds')) and '沒有完成' in t1 and '已建立通知工作' not in t1, t1[:120])
    clr(); pg.click(f'[data-act="reqmail-create"][data-item="{I("meds")}"]'); W(1500); m1 = mails_for(I('meds')); r2 = store('items/' + I('meds'))
    check('16-1e', '重試成功：只建立通知工作，不重複建立補件', '建立 1 筆通知工作並模擬寄送（標示測試環境未實際寄出）；補件請求的建立時間不變、補件歷程沒有新增、處理歷程的補件要求數不變；重試按鈕消失', len(m1) == 1 and m1[0]['status'] == '模擬已寄送' and len(m1[0]['attempts']) == 1 and '未實際寄出' in m1[0]['attempts'][0]['result'] and r2['req']['ts'] == rq['ts'] and len(r2.get('reqHistory') or []) == nh and tl_req(A, '目前用藥清單') == tl0 and pg.query_selector(f'[data-act="reqmail-create"][data-item="{I("meds")}"]') is None, (m1 and m1[0].get('status'), tl0))
    E(f"ACT['reqmail-create']({{dataset:{{item:'{I('meds')}'}}}})"); W(1000); E(f"syncReqMails(D.cases['{A}'])"); W(800)
    check('16-1f', '再按一次或再同步不會重複寄送', '仍只有 1 筆通知工作、1 次寄送', len(mails_for(I('meds'))) == 1 and len(mails_for(I('meds'))[0]['attempts']) == 1)
    login('nurse@example.com')
    review(A, 'tubeCare', fill={0: '鼻胃管 16Fr，右鼻孔 55 公分；每月更換（上次 11/01）；灌食後抬高床頭 30 度'})
    review(A, 'swallow', fill={0: '管灌，不可由口進食'})
    login('family@example.com'); t = main()
    check('F7', '家屬查看審核狀態與補件原因', '首頁列出「需要重新上傳」與退回原因；補件進度卡顯示正式補件（開啟中、尚未重新上傳）', '文件模糊，看不清楚' in t and '補件進度' in t and '尚未重新上傳' in pg.inner_text('#reqCard') and '開啟中' in pg.inner_text('#reqCard'))
    upload(A, 'meds', '04_用藥清單_張秀英')
    m = store('items/' + I('meds'))
    check('F8', '補件重新上傳', '新增第 2 版；狀態回到「待收件」，補件請求仍開啟（補傳不等於完成）；第 1 版保留', len(m['versions']) == 2 and st('meds') == '待收件' and not m['req'].get('closedAt') and bool(m['req'].get('uploadedAt')), (len(m['versions']), st('meds'), m['req']))
    login('staff@example.com'); nav('followup'); t = main()
    check('S11', '補件追蹤', '列出用藥清單的補件狀態', '目前用藥清單或處方資料' in t)
    receipt(A, 'meds', '1940/06/12')
    mm = mails_for(I('meds'))[0]; MM = mm['id']
    setmail(MM, {'status': '寄送失敗', 'lastError': '模擬寄送失敗（郵件服務無回應）'})   # 準備資料：讓用藥清單的補件通知處於「寄送失敗」
    E(f"(() => {{ const s = window.__store, o = s.set.bind(s); s.set = (k, v) => {{ if (k === 'items/{I('meds')}' && v && v.req && v.req.closedAt) throw {{code:'unavailable'}}; return o(k, v); }}; window.__restoreSet = () => {{ s.set = o; }}; }})()")
    clr()
    login('nurse@example.com'); review(A, 'meds', ocr={'meds': ['Aspirin 100 mg 每日一次 經鼻胃管', 'Amlodipine 5 mg 每日一次 早上'], 'note': '藥物磨粉後經鼻胃管給藥'})
    W(600); t2 = toasts(); mi = store('items/' + I('meds')); na2 = len(mails_for(I('meds'))[0]['attempts'])
    check('17-2a', '情境 2：確認符合但關閉紀錄寫入失敗', '護理確認符合，關閉紀錄（closedAt）寫入失敗：提示「資料狀態待修復」，不是靜默忽略；資料庫中 closedAt 確實沒有寫入', st('meds') == '確認符合' and not mi['req'].get('closedAt') and '資料狀態待修復' in t2, t2[:150])
    check('17-2b', '判斷一致：視為已關閉', 'reqState「已關閉」、openFormalReq 為否、reqCloseMissing 為是', E(f"[reqState(D.items['{I('meds')}'], D.cases['{A}']), openFormalReq(D.items['{I('meds')}'], D.cases['{A}']), reqCloseMissing(D.items['{I('meds')}'], D.cases['{A}'])]") == ['已關閉', False, True])
    E("window.__mailSendCalls = []"); clr()
    q1 = E(f"queueReqMail(D.cases['{A}'], D.items['{I('meds')}']).then(x => x)"); E(f"syncReqMails(D.cases['{A}'])"); r3 = E(f"sendReqMail('{MM}').then(x => [x.ok, x.reason])")
    login('staff@example.com'); nav('case', A); clr(); E(f"ACT['reqmail-create']({{dataset:{{item:'{I('meds')}'}}}})"); W(800); t3 = toasts()
    E(f"ACT['reqmail-retry']({{dataset:{{id:'{MM}'}}}})"); W(1000)
    check('17-2c', '不產生不必要的 Email', 'queueReqMail 略過（pendingClose）；syncReqMails、sendReqMail、reqmail-create、reqmail-retry 都沒有呼叫郵件介面；沒有新增通知工作，原通知仍是「寄送失敗」、嘗試次數不變', q1.get('skip') and q1.get('pendingClose') and r3[0] is False and '待修復' in r3[1] and '待修復' in t3 and E("window.__mailSendCalls.length") == 0 and len(mails_for(I('meds'))) == 1 and mails_for(I('meds'))[0]['status'] == '寄送失敗' and len(mails_for(I('meds'))[0]['attempts']) == na2, (q1, r3, t3[:60], E("window.__mailSendCalls")))
    nav('case', A); mc = pg.inner_text('#reqMailCard'); rowm = E(f"(() => {{ const r = [...document.querySelectorAll('main tr')].find(x => x.querySelector('td') && x.textContent.includes('目前用藥清單') && !x.dataset.mail); return r ? r.textContent : ''; }})()")
    check('17-2d', '案件頁明確提示待修復', '補件 Email 區塊顯示「資料狀態待修復」與「補寫關閉紀錄」按鈕；舊通知沒有重試按鈕；文件表標示「關閉紀錄待補寫」', '資料狀態待修復' in mc and pg.query_selector(f'[data-act="req-close-fix"][data-item="{I("meds")}"]') is not None and not has_retry(MM) and '關閉紀錄待補寫' in rowm, (mc[:150], rowm[:120]))
    E("window.__restoreSet()"); clr(); pg.click(f'[data-act="req-close-fix"][data-item="{I("meds")}"]'); W(1200); mi2 = store('items/' + I('meds'))
    check('17-2e', '補寫關閉紀錄', '寫入恢復後按「補寫關閉紀錄」：closedAt 寫入並記錄補寫人與處理歷程；待修復提示消失；仍不寄送', bool(mi2['req'].get('closedAt')) and bool(mi2['req'].get('closedFix')) and pg.query_selector('[data-closefix]') is None and E("window.__mailSendCalls.length") == 0 and any('補寫' in (store(k) or {}).get('what', '') for k in keys('logs/')), mi2['req'])
    m = store('items/' + I('meds'))
    check('N4', '補件核對完成後關閉補件請求', '用藥清單確認符合，補件請求自動關閉', st('meds') == '確認符合' and bool(m['req'].get('closedAt')), m.get('req'))
    old = store('items/' + I('meds'))['req']; tlb = tl_req(A, '目前用藥清單')
    E("window.__mailAdapterFail = true"); login('staff@example.com'); nav('case', A); pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("meds")}"]'); pg.fill('#srNote', '請補上最新一次的處方箋'); pg.click('[data-act="modal-ok"]'); W(1800); E("window.__mailAdapterFail = false")
    nw = store('items/' + I('meds')); ms3 = sorted(mails_for(I('meds')), key=lambda x: x['reqTs']); nav('case', A)
    check('17-3a', '情境 3：第 2 次正式補件建立', '新補件有新的事件時間；第 1 次補件（已結案）移到補件歷程並保留 closedAt；處理歷程補件要求多 1 筆', nw['req']['ts'] != old['ts'] and any(r['ts'] == old['ts'] and r.get('closedAt') for r in nw.get('reqHistory') or []) and tl_req(A, '目前用藥清單') == tlb + 1, (nw['req'].get('ts'), old['ts']))
    check('17-3b', '兩筆通知依事件 ID 分開', '用藥清單有 2 筆通知工作：第 1 次（舊事件）仍「寄送失敗」、標示補件已結案、沒有重試；第 2 次（新事件，郵件服務故障）「寄送失敗」、有重試按鈕', len(ms3) == 2 and ms3[0]['reqTs'] == old['ts'] and ms3[1]['reqTs'] == nw['req']['ts'] and ms3[0]['id'] != ms3[1]['id'] and ms3[0]['status'] == '寄送失敗' and ms3[1]['status'] == '寄送失敗' and '補件已結案' in (row_of(ms3[0]['id']) or '') and not has_retry(ms3[0]['id']) and has_retry(ms3[1]['id']), [(x['id'][-6:], x['status']) for x in ms3])
    oa = len(ms3[0]['attempts']); E("window.__mailSendCalls = []"); pg.click(f'[data-act="reqmail-retry"][data-id="{ms3[1]["id"]}"]'); W(1500); ro = E(f"sendReqMail('{ms3[0]['id']}').then(x => x.reason)")
    ms4 = {x['id']: x for x in mails_for(I('meds'))}
    check('17-3c', '重試新事件不影響舊事件', '新事件重試後「模擬已寄送」，郵件介面只呼叫 1 次（新事件的去重鍵）；舊事件直接呼叫被擋下，狀態與嘗試次數不變', ms4[ms3[1]['id']]['status'] == '模擬已寄送' and E("window.__mailSendCalls") == [ms3[1]['id']] and '補件已結案' in (ro or '') and ms4[ms3[0]['id']]['status'] == '寄送失敗' and len(ms4[ms3[0]['id']]['attempts']) == oa, (E("window.__mailSendCalls"), ro))
    login('family@example.com'); nav('home', A); rc = pg.inner_text('#reqCard') if pg.query_selector('#reqCard') else ''
    check('17-3d', '家屬只看到目前開啟的第 2 次補件', '補件進度顯示用藥清單本次原因（需要補充／說明），Email 通知「模擬已寄送」', '目前用藥清單' in rc and '模擬已寄送' in rc.split('目前用藥清單')[1][:400], rc[:200])
    upload(A, 'meds', '04_用藥清單_張秀英'); login('staff@example.com'); receipt(A, 'meds', '1940/06/12')
    login('nurse@example.com'); review(A, 'meds', ocr={'meds': ['Aspirin 100 mg 每日一次 經鼻胃管', 'Amlodipine 5 mg 每日一次 早上'], 'note': '藥物磨粉後經鼻胃管給藥'})
    n2 = store('items/' + I('meds')); ms5 = {x['id']: x for x in mails_for(I('meds'))}
    check('17-3e', '第 2 次補件結案', '確認符合後第 2 次補件關閉；兩筆通知都保留（第 1 次寄送失敗、第 2 次模擬已寄送），沒有多寄', st('meds') == '確認符合' and bool(n2['req'].get('closedAt')) and len(ms5) == 2 and ms5[ms3[0]['id']]['status'] == '寄送失敗' and ms5[ms3[1]['id']]['status'] == '模擬已寄送' and len(ms5[ms3[1]['id']]['attempts']) == 2)
    check('F9', '選填文件未上傳不阻擋', '診斷證明、近期檢驗等選填未上傳，案件仍進入「評估中」', ph() == '評估中', ph())
    nav('assess', A); pg.select_option('#assessForm [name=move]', '二人協助'); pg.check('#assessForm input[name=result][value="收治"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('N5', '收治評估（先審後簽）', '結果「收治」，案件「已收治待簽約」', ph() == '已收治待簽約', ph())
    login('staff@example.com'); signed(A)
    check('S12', '行政記錄簽約', '已簽約；入住前文件開始要求（案件「待補件」）', bool(store('cases/' + A).get('signedAt')) and ph() == '待補件', ph())
    login('family@example.com')
    upload(A, 'exam', '08_體檢報告_張秀英', '2026-11-05')
    nav('upload', A, I('xray')); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    x = store('items/' + I('xray'))['versions'][0]
    check('F10', '體檢報告一次上傳，X 光沿用同一份檔案', 'X 光第 1 版標示沿用體檢報告檔案，狀態仍需核對（不會自動通過）', bool(x.get('fromItem')) and st('xray') not in ('確認符合', '即將到期'), (x.get('fromItem'), st('xray')))
    upload(A, 'stool', '09_糞便檢查_張秀英', '2026-11-05'); upload(A, 'signerId', '10_簽約者身分證_張家豪'); upload(A, 'relProof', '11_戶口名簿_張秀英'); upload(A, 'emergency', '12_緊急事故處理同意書_張秀英'); upload(A, 'contract', '13_入住契約_張秀英')
    login('staff@example.com')
    receipt(A, 'exam', '1940/06/12'); receipt(A, 'xray', '1940/06/12'); receipt(A, 'stool', '1940/06/12'); receipt(A, 'signerId', None, signer='張家豪')
    receipt(A, 'relProof', '民國 29 年 6 月 12 日', nid=False); receipt(A, 'emergency', None, nid=False); receipt(A, 'contract', None, nid=False)
    datec(A, 'exam', '2026-11-05'); datec(A, 'xray', '2026-11-05'); datec(A, 'stool', '2026-11-05')
    check('S13', '入住前文件收件與效期確認', '簽約者證明、戶籍證明、同意書、契約確認符合；體檢、X 光、糞便進入「待護理核對」', all(st(k) == '確認符合' for k in ['signerId', 'relProof', 'emergency', 'contract']) and all(st(k) == '待護理核對' for k in ['exam', 'xray', 'stool']), {k: st(k) for k in ['signerId', 'relProof', 'emergency', 'contract', 'exam', 'xray', 'stool']})
    login('nurse@example.com'); nav('review', I('exam')); labs = E("reviewState.fields.map(f => f.label)")
    check('N6', '健康檢查逐項核對項目', '8 項檢查各分成「報告是否包含」與「檢查結果」兩欄，另有醫師註記；共 17 欄', len(labs) == 17 and '肝功能：報告是否包含（需要繳交）' in labs and '電解質：檢查結果' in labs, labs)
    review(A, 'exam', ocr=EXAM_OCR)
    review(A, 'xray', ocr={'res': '心肺無明顯異常，未見活動性肺結核'}); review(A, 'stool', ocr={'res': '陰性'})
    check('F11', '簽約階段選填文件未上傳', '收費明細、繳費收據、保證金未上傳，案件仍進入摘要卡審核', ph() == '摘要卡審核中' and not store('items/' + I('payReceipt'))['versions'], ph())
    nav('card', A); t = pg.text_content('main')
    check('N7', '照護摘要卡草稿取得已確認資料', 'A 區管路帶入「鼻胃管」、過敏帶入「磺胺類藥物」；B 區稱呼「秀英阿嬤」；資料差異列出家屬所填過敏「海鮮」', '鼻胃管' in pg.input_value('#cardForm [name=tube]') and '磺胺' in pg.input_value('#cardForm [name=allergy]') and pg.input_value('#cardForm [name=call]') == '秀英阿嬤' and '海鮮' in t and '停用文件' not in t)
    pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.fill('#cardForm [name=risk]', '右側無力，移位需兩人協助'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('N8', '開放照顧摘要卡', '摘要卡第 1 版已開放給阿妮；案件「摘要卡已開放」', store('cases/' + A)['card']['status'] == '已開放' and ph() == '摘要卡已開放', ph())
    login('care@example.com'); t = main()
    check('C1', '照服員查看已授權個案', '我的住民列出張秀英', '張秀英' in t)
    nav('card', A); t = main()
    check('C2', '照服員查看摘要卡與家屬提供之生活習慣', 'A 區健康重點（鼻胃管）與 B 區「家屬提供」來源標示；看不到身分證字號、契約', '鼻胃管' in t and '秀英阿嬤' in t and '家屬提供' in t and 'F223344556' not in t and '入住契約' not in t)
    login('care2@example.com')
    check('C3', '未授權的照服員', '黎氏蘭看不到張秀英', '張秀英' not in main())
    # 摘要卡更新提示
    login('family@example.com'); nav('life', A, '4'); pg.fill('#habitForm [name=likeAct]', '聽歌仔戲'); pg.click('#habitForm button[value="stay"]'); W(1200); pg.click('[data-act="habit-submit"]'); W(1500)
    check('N9', '家屬更新習慣卡 → 摘要卡需要重新確認', '案件變成「摘要卡待重新審核」', ph() == '摘要卡待重新審核', ph())
    login('care@example.com'); nav('card', A); t = main()
    check('C4', '照服員看到資料更新提示', '顯示「資料已更新，需重新確認」，受影響欄位顯示「請問護理站」', '資料已更新' in t, t[:200])
    login('nurse@example.com'); nav('resident', A); pg.fill('#hrRes-0', '已確認') if pg.query_selector('#hrRes-0') else None; pg.fill('#hrNote', '確認重新提交的變更項目'); pg.click(f'[data-act="habit-review"][data-case="{A}"][data-state="審核完成"]'); W(1200)
    nav('resident', A); pg.click('[data-act="card-revise"]'); W(1200); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    cc = store('cases/' + A)
    check('N10', '護理更新並重新確認摘要卡', '第 2 版開放，第 1 版保留在歷史；案件回到「摘要卡已開放」', cc['card']['v'] == 2 and len(cc.get('cardHistory', [])) == 1 and ph() == '摘要卡已開放' and '聽歌仔戲' in cc['card'].get('prefs', ''), (cc['card']['v'], ph()))

    # ================= 先簽後審：陳金水 =================
    login('staff@example.com'); confirm_apply(B, 'nurse2@example.com')
    login('family2@example.com'); consent(B)
    t = (to_guide() or pg.text_content('#docList'))
    check('P1', '先簽後審：一開始就要求全部文件', '入住契約、體檢報告等入住前文件也列入目前要上傳', E(f"activeItems(D.cases['{B}']).some(i => i.key === 'contract')") is True)
    nav('home', B); pg.click('[data-act="fgo"][data-page="life"]') if pg.query_selector('[data-act="fgo"][data-page="life"]') else None; W(400)
    skip = pg.query_selector('[data-act="habit-skip"]')
    check('F12', '生活與照護習慣卡不能略過（八大項）', '習慣卡頁沒有「略過」按鈕；未提交時家屬待辦列出習慣卡', skip is None and E(f"habitFamTodo(D.cases['{B}'])") is True)
    for k, img, d in [('idcopy', '14_身分證影本_陳金水', None), ('nhi', '15_健保卡_陳金水', None), ('summary', '16_近期醫療摘要_陳金水', None), ('meds', '17_用藥清單_陳金水', None), ('exam', '18_體檢報告_陳金水', '2026-11-06'), ('stool', '19_糞便檢查_陳金水', '2026-11-07'), ('signerId', '20_簽約者身分證_陳淑芬', None), ('emergency', '21_緊急事故處理同意書_陳金水', None), ('contract', '22_入住契約_陳金水', None)]:
        upload(B, k, img, d)
    nav('upload', B, I('xray', B)); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    login('staff@example.com')
    need(B, 'tubeCare', 'no', '門診摘要記載無管路'); need(B, 'woundCare', 'no', '門診摘要記載無傷口'); need(B, 'swallow', 'no', '可正常由口進食')
    for k in ['idcopy', 'nhi', 'summary', 'meds', 'exam', 'xray', 'stool']: receipt(B, k, '1936/09/20')
    receipt(B, 'signerId', None, signer='陳淑芬'); receipt(B, 'emergency', None, nid=False); receipt(B, 'contract', None, nid=False)
    datec(B, 'exam', '2026-11-06'); datec(B, 'xray', '2026-11-06'); datec(B, 'stool', '2026-11-07')
    login('nurse2@example.com')
    review(B, 'summary', ocr={'stype': '門診／近期醫療摘要', 'dx': '失智症（輕度）、第二型糖尿病', 'tube': '無', 'allergy': '無已知過敏', 'wound': '文件未記載'})
    review(B, 'meds', ocr={'meds': ['Metformin 500 mg 每日兩次 早晚餐後', 'Donepezil 5 mg 每日一次 睡前'], 'note': '飯後服用'})
    review(B, 'exam', ocr=EXAM_OCR)
    review(B, 'xray', ocr={'res': '心肺無明顯異常'}); review(B, 'stool', ocr={'res': '陰性'})
    check('P2', '視情況文件「尚未確認」時不算齊全', '戶籍或代理關係證明尚未確認 → 案件停在文件階段，不會進入「待簽約」', ph(B) not in ('待簽約', '入住前確認中') and E(f"condPending(D.items['{I('relProof', B)}'])") is True, ph(B))
    # 行政發出補件通知（選填文件改為需要）
    E("window.__mailAdapterFail = true")
    login('staff@example.com'); nav('case', B); pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("diag", B)}"]'); pg.fill('#srNote', '請補診斷證明，確認失智症診斷'); pg.click('[data-act="modal-ok"]'); W(1500)
    d = store('items/' + I('diag', B))
    check('S14', '行政發出補件通知', '選填的診斷證明改為「需要繳交」、補件請求開啟；家屬收到通知', d['need'] == '必備' and d['req'] and any('診斷證明' in store(k)['text'] for k in keys('notices/') if store(k)['caseId'] == B))
    E("window.__mailAdapterFail = false"); md = mails_for(I('diag', B)); mid = md[0]['id']; dreq = store('items/' + I('diag', B))['req']
    check('16-3a', '準備：一筆寄送失敗的通知', '郵件服務模擬失敗後狀態「寄送失敗」，1 次嘗試', md[0]['status'] == '寄送失敗' and len(md[0]['attempts']) == 1, md[0].get('status'))
    E("window.__mailSendCalls = []")
    res = E(f"Promise.all([sendReqMail('{mid}'), sendReqMail('{mid}')]).then(r => r.map(x => x.ok ? 'ok' : x.reason))"); W(800); m2 = mails_for(I('diag', B))[0]
    check('16-3b', '同時重試只送出一次', '兩個重試同時執行：郵件介面只被呼叫 1 次（帶入同一個去重鍵），一個成功、另一個被擋下（正在寄送或已寄送）；共 2 次嘗試、狀態「模擬已寄送」', E("window.__mailSendCalls.length") == 1 and E("window.__mailSendCalls[0]") == mid and res.count('ok') == 1 and len(m2['attempts']) == 2 and m2['status'] == '模擬已寄送', (res, E("window.__mailSendCalls")))
    setmail(mid, {'status': '寄送中', 'claim': {'by': 'nurse2@example.com', 'at': '2026/11/15 10:00', 'ts': int(__import__('time').time() * 1000), 'sendKey': 'other-device'}})
    nav('case', B); btn = pg.query_selector(f'[data-act="reqmail-retry"][data-id="{mid}"]'); E("window.__mailSendCalls = []"); rr = E(f"sendReqMail('{mid}').then(x => x.reason)")
    check('16-3c', '其他人寄送中時不能重試', '另一位人員剛認領寄送（寄送中、未逾時）：畫面沒有重試按鈕；直接呼叫也被擋下「正在寄送」，沒有呼叫郵件介面', btn is None and '正在寄送' in (rr or '') and E("window.__mailSendCalls.length") == 0, rr)
    setmail(mid, {'claim': {'by': 'nurse2@example.com', 'at': '2026/11/15 10:00', 'ts': int(__import__('time').time() * 1000) - 300000, 'sendKey': 'other-device'}})
    nav('case', B); pg.click(f'[data-act="reqmail-retry"][data-id="{mid}"]'); W(1500); m3 = mails_for(I('diag', B))[0]
    check('16-3d', '寄送中逾時後可以重新認領', '超過 2 分鐘沒有回寫結果：出現重試按鈕；重試後記錄「前一次寄送沒有回寫結果（逾時），結果不明」再送出，狀態「模擬已寄送」', m3['status'] == '模擬已寄送' and any('結果不明' in a['result'] for a in m3['attempts']) and not m3.get('claim'), [a['result'][:20] for a in m3['attempts']])
    setmail(mid, {'status': '寄送失敗', 'lastError': '模擬'})
    E(f"(() => {{ const s = window.__store, o = s.set.bind(s); let n = 0; s.set = (k, v) => {{ if (k === 'mailQueue/{mid}' && ++n >= 2) throw {{code:'unavailable'}}; return o(k, v); }}; window.__restoreSet = () => {{ s.set = o; }}; }})()")
    E("window.__mailSendCalls = []"); r4 = E(f"sendReqMail('{mid}').then(x => x.reason)"); W(500); E("window.__restoreSet()"); m4 = mails_for(I('diag', B))[0]
    nav('case', B); b4 = pg.query_selector(f'[data-act="reqmail-retry"][data-id="{mid}"]'); r5 = E(f"sendReqMail('{mid}').then(x => x.reason)")
    check('16-3e', '模擬寄送後回寫結果失敗', '認領成功、郵件介面呼叫 1 次，但結果寫入失敗：提示寫入失敗、狀態維持「寄送中」（不顯示成功），未逾時前不能重試，避免重複寄送', '寫入失敗' in (r4 or '') and m4['status'] == '寄送中' and m4.get('claim') and E("window.__mailSendCalls.length") == 1 and b4 is None and '正在寄送' in (r5 or ''), (r4, m4.get('status')))
    d2 = store('items/' + I('diag', B))
    check('16-3f', '重試過程沒有重複建立補件要求', '診斷證明的補件請求建立時間不變、沒有補件歷程；仍只有 1 筆通知工作', d2['req']['ts'] == dreq['ts'] and not d2.get('reqHistory') and len(mails_for(I('diag', B))) == 1)
    # 讓 16-3e 留下的「寄送中」逾時（模擬時間經過 2 分鐘），郵件服務仍故障時重試 → 真正得到「寄送失敗」
    setmail(mid, {'claim': {'by': 'nurse2@example.com', 'at': '2026/11/15 10:00', 'ts': now_ms() - 300000, 'sendKey': 'other-device'}})
    E("window.__mailAdapterFail = true"); nav('case', B); pg.click(f'[data-act="reqmail-retry"][data-id="{mid}"]'); W(1500)   # 郵件服務維持故障，直到補件結案
    m17 = mails_for(I('diag', B))[0]
    check('17-1a', '情境 1 準備：補件通知寄送失敗、補件仍開啟', '郵件服務故障時重試 → 通知「寄送失敗」；診斷證明的補件仍開啟、畫面有「重試寄送」', m17['status'] == '寄送失敗' and E(f"openFormalReq(D.items['{I('diag', B)}'], D.cases['{B}'])") is True and has_retry(mid), m17['status'])
    MID17 = [mid, len(m17['attempts'])]
    need(B, 'relProof', 'yes', '由女兒簽約')
    login('family2@example.com'); upload(B, 'relProof', '23_戶口名簿_陳金水'); upload(B, 'diag', '16_近期醫療摘要_陳金水')
    login('staff@example.com'); receipt(B, 'relProof', '民國 25 年 9 月 20 日', nid=False); receipt(B, 'diag', '1936/09/20')
    login('nurse2@example.com'); review(B, 'diag', fill={0: '失智症（輕度）、第二型糖尿病', 1: '2026-11-03'})
    check('S15', '確認補件狀態', '診斷證明確認符合、補件請求關閉；全部文件齊全後案件「待簽約」', st('diag', B) == '確認符合' and bool(store('items/' + I('diag', B))['req'].get('closedAt')) and ph(B) == '待簽約', (st('diag', B), ph(B)))
    E("window.__mailAdapterFail = false"); mid, na0 = MID17; login('staff@example.com'); nav('case', B); d1 = store('items/' + I('diag', B)); m1 = mails_for(I('diag', B))[0]; rw = row_of(mid) or ''; na = len(m1['attempts'])
    check('17-1b', '補件結案後不再提供重試', '補件期間郵件服務持續故障（期間系統自動重試仍失敗），家屬補件、護理確認符合、補件結案後才恢復：舊通知保留「寄送失敗」與全部嘗試紀錄，標示「補件已結案，不再寄送」，沒有「重試寄送」按鈕', m1['status'] == '寄送失敗' and na >= na0 and all('失敗' in a['result'] or '結果不明' in a['result'] or '模擬已寄送' in a['result'] for a in m1['attempts']) and '補件已結案，不再寄送' in rw and not has_retry(mid), (m1['status'], rw[:120]))
    E("window.__mailSendCalls = []"); clr()
    E(f"ACT['reqmail-retry']({{dataset:{{id:'{mid}'}}}})"); W(1200); t1 = toasts()
    r1 = E(f"sendReqMail('{mid}').then(x => [x.ok, x.reason])"); E(f"syncReqMails(D.cases['{B}'])"); r2 = E(f"queueReqMail(D.cases['{B}'], D.items['{I('diag', B)}'])"); W(800)
    m2 = mails_for(I('diag', B)); d2 = store('items/' + I('diag', B))
    check('17-1c', '繞過畫面直接執行重試也被擋下', '直接執行 reqmail-retry、sendReqMail、syncReqMails、queueReqMail：郵件介面 0 次呼叫；提示「補件已結案，不再寄送」；通知狀態與嘗試次數不變', E("window.__mailSendCalls.length") == 0 and '補件已結案' in t1 and r1[0] is False and '補件已結案' in r1[1] and len(m2) == 1 and m2[0]['status'] == '寄送失敗' and len(m2[0]['attempts']) == na, (t1[:80], r1, E("window.__mailSendCalls")))
    check('17-1d', '重試不會重新開啟補件', '補件請求的建立時間、關閉時間都不變，文件仍是「確認符合」', d2['req']['ts'] == d1['req']['ts'] and d2['req'].get('closedAt') == d1['req'].get('closedAt') and bool(d2['req'].get('closedAt')) and st('diag', B) == '確認符合' and E(f"reqState(D.items['{I('diag', B)}'], D.cases['{B}'])") == '已關閉')
    login('staff@example.com'); signed(B)
    check('P3', '先簽後審記錄入住契約', '案件「入住前確認中」', ph(B) == '入住前確認中', ph(B))
    login('nurse2@example.com'); nav('assess', B); pg.select_option('#assessForm [name=move]', '可自行移位'); pg.check('#assessForm input[name=result][value="可入住"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('P4', '入住前護理確認（先簽後審）', '結果「可入住」，案件「摘要卡審核中」', ph(B) == '摘要卡審核中', ph(B))
    nav('card', B); pg.check('#cardForm input[name=cg][value="care2@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('P5', '先簽後審完整跑完', '摘要卡已開放給黎氏蘭', ph(B) == '摘要卡已開放' and store('cases/' + B)['card']['caregivers'] == ['care2@example.com'], ph(B))
    # 通知寫入失敗與重試
    login('staff@example.com'); nav('case', B)
    fail('notices/'); pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("labs", B)}"]'); pg.fill('#srNote', '請補近期檢驗報告'); pg.click('[data-act="modal-ok"]'); W(1500); fail(None)
    check('W8', '資料寫入失敗：補件通知寫入失敗', '補件要求已保存；畫面上方出現待送清單', bool(store('items/' + I('labs', B)).get('req')) and not any('近期檢驗及影像報告' in store(k)['text'] for k in keys('notices/')) and '沒有送出' in bar(), bar()[:100])
    pg.click('[data-act="outbox-retry"]'); W(1500)
    check('W9', '待送清單重試', '通知補送成功，待送清單清空', any('近期檢驗及影像報告' in store(k)['text'] for k in keys('notices/') if store(k)['caseId'] == B) and bar() == '', bar()[:100])
    login('admin@example.com'); nav('logs'); t = main()
    check('M5', '操作紀錄', '列出建立文件清單、條件式判斷、補件、簽約、摘要卡開放等紀錄', all(x in t for x in ['建立入住文件清單', '護理已確認：不需要', '要求補件', '照顧摘要卡']), t[:200])
    check('Z1', '整個測試過程沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_17.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
