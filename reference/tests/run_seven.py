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

    import re as _re
    folders = lambda: E("[...document.querySelectorAll('details.folder')].map(d => [d.dataset.case, d.open])")
    elder = lambda txt: [m for m in _re.findall(r'.{0,12}長輩.{0,12}', txt)]
    life_btns = lambda: E("document.querySelectorAll('main [data-page=\"life\"]').length")
    mails_for = lambda iid: [dict(store(k), id=k.split('/', 1)[1]) for k in keys('mailQueue/') if (store(k) or {}).get('itemId') == iid]
    texts = {}

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
    E(f"(async () => {{ await db.doc('notices/old-notice-1').set({{caseId:'{A}', to:'family@example.com', text:'（舊通知）請準備長輩的健保卡', at:'2026/11/09 10:00', ts:1794200000000, read:false}}); await db.doc('logs/old-log-1').set({{caseId:'{A}', who:'系統', what:'（舊紀錄）長輩資料已建立', at:'2026/11/09 10:00', ts:1794200000000}}); }})()"); W(600)
    check('S1', '行政確認申請', '已確認、指定黃護理師；文件清單沿用申請時建立的 24 份（不重建）；家屬收到通知', store('cases/' + A)['linkStatus'] == '已確認' and len([k for k in keys('items/') if k.startswith('items/' + A + '_')]) == 24 and any(store(k)['caseId'] == A for k in keys('notices/')))
    login('family@example.com'); consent(A)
    check('S2', '家屬簽署資料授權（沿用線上簽署）', '授權有效；個資同意列在 E 類為線上簽署，沒有另外的上傳項目', E(f"consentOk(D.cases['{A}'])") and '個人資料蒐集、處理及利用同意書（線上簽署）' in (to_guide() or pg.text_content('#docList')) and not any('個人資料' in store(k)['name'] for k in keys('items/' + A)))
    nav('home', A); t = main(); ht = pg.inner_text('#todoHero') if pg.query_selector('#todoHero') else ''
    n_docs = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).length")
    check('7-2a', '習慣卡只有一個主要操作入口', '「目前需要處理」列出習慣卡與「開始填寫」；頁面上沒有另一張習慣卡卡片，前往習慣卡的按鈕只有 1 個', '住民生活與照護習慣卡（必填）' in ht and '開始填寫' in ht and pg.query_selector('#habitCard') is None and life_btns() == 1, (life_btns(), ht[:100]))
    check('7-2b', '「X 份文件」不含習慣卡', f'標題為「您還需要上傳 {n_docs} 份文件，並提交習慣卡」', f'您還需要上傳 {n_docs} 份文件，並提交習慣卡' in ht.replace('\n', ' ').replace(f' {n_docs} ', f' {n_docs} '), ht[:80])
    check('7-4a', '首次繳交不列入補件進度', '還沒上傳任何文件、也沒有正式補件：沒有「補件進度」區塊；文件顯示在目前需要處理', pg.query_selector('#reqCard') is None and '補件進度' not in t)
    check('7-6a', '首頁不重複顯示機構通知', '案件首頁沒有「機構通知」清單，只有「這筆申請有 n 則未讀通知」的連結', '機構通知' not in t and pg.query_selector('#noticeLink') is not None and '未讀通知' in pg.inner_text('#noticeLink'))
    texts['family_home'] = t
    nav('life', A); texts['life'] = main(); nav('consent', A); texts['consent'] = main(); to_guide(); texts['guide'] = pg.text_content('main')
    nav('notices'); nt = main(); n0 = len(keys('notices/'))
    check('7-6b', '通知頁保留完整通知', '通知頁列出通知全文、時間、未讀狀態、案件名稱與編號，並有「前往案件」', '本中心已確認您的申請' in nt and ('未讀' in nt or '已讀' in nt) and '張秀英' in nt and 'C-0001' in nt and pg.query_selector('#noticeList [data-act="go"][data-page="home"]') is not None, nt[:150])
    pg.click('#noticeList [data-act="go"][data-page="home"] >> nth=0'); W(400)
    E("render(false)"); W(200); E("render(false)"); W(200)
    check('7-6c', '點通知可前往案件；重新渲染不會多出通知', '點「前往案件」到案件首頁；畫面重新渲染兩次後通知數量不變', E("route.page") == 'home' and len(keys('notices/')) == n0)
    check('7-3a', '舊通知與舊紀錄維持原文', '資料庫中含「長輩」的舊通知與操作紀錄沒有被改寫；通知頁照原文顯示', store('notices/old-notice-1')['text'] == '（舊通知）請準備長輩的健保卡' and store('logs/old-log-1')['what'] == '（舊紀錄）長輩資料已建立' and '請準備長輩的健保卡' in nt)
    login('staff@example.com'); nav('followup'); fu = main()
    check('7-4b', '行政補件追蹤區分首次繳交與正式補件', '尚未首次上傳的文件標示「首次繳交」', '首次繳交' in fu and '正式補件' not in fu)
    E(f"ACT['remind']({{dataset:{{item:'{I('idcopy')}'}}}})"); W(1200); rq = store('items/' + I('idcopy'))
    check('7-4c', '再次提醒不會建立正式補件', '提醒首次繳交的住民身分證明文件：只記錄提醒，沒有建立補件請求，家屬端沒有補件進度', not rq.get('req') and rq.get('remind') and rq['remind']['n'] == 1 and not mails_for(I('idcopy')), rq.get('remind'))
    E(f"(async () => {{ const x = JSON.parse(JSON.stringify(window.__store.get('items/{I('nhi')}'))); x.req = {{reason:'未上傳', due:'2026-11-30'}}; await db.doc('items/{I('nhi')}').set(x); }})()"); W(800)
    login('family@example.com'); nav('home', A)
    check('7-4d', '舊版提醒留下的假補件請求不列入補件進度', '舊資料「原因只有狀態文字、沒有來源」的 req 保留在資料庫，但不算正式補件、不顯示補件進度', pg.query_selector('#reqCard') is None and store('items/' + I('nhi'))['req']['reason'] == '未上傳')
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
    login('family@example.com'); E(f"window.__autoHabitSkip = ['{A}']"); hab_submit(A); nav('home', A)
    ht = pg.inner_text('#todoHero') if pg.query_selector('#todoHero') else ''; hrow = pg.inner_text('#habitRow') if pg.query_selector('#habitRow') else ''
    check('7-2c', '正式提交後不再列為待提交', '目前要做的事不再提示提交習慣卡；習慣卡列在「正在等待本中心審核」，顯示「已提交，待護理初審」與「查看狀態」；前往習慣卡的按鈕仍只有 1 個', '提交習慣卡' not in ht and '開始填寫' not in ht and '已提交，待護理初審' in hrow and '查看狀態' in hrow and E("!!document.querySelector('#grpWait #habitRow')") and life_btns() == 1, (ht[:80], hrow))
    login('staff@example.com'); E("workTab = 'todo'; wbQ = ''; go('home')"); W(400); f0 = folders()
    sm = pg.inner_text(f'details.folder[data-case="{A}"] > summary'); inner = pg.inner_text(f'details.folder[data-case="{A}"]')
    check('7-1a', '行政個案資料夾預設收合', '所有資料夾都收合；外層顯示住民姓名、案件編號、狀態、必要待辦數、最近更新；收合時看不到工作內容', f0 and all(not o for _, o in f0) and all(x in sm for x in ['張秀英', 'C-0001', '必要待辦', '最近更新']) and '本階段必要待辦' not in inner, (f0, sm))
    pg.click(f'details.folder[data-case="{A}"] > summary'); W(300); o1 = E(f"document.querySelector('details.folder[data-case=\"{A}\"]').open"); body = pg.inner_text(f'details.folder[data-case="{A}"]')
    pg.click(f'details.folder[data-case="{A}"] > summary'); W(300); o2 = E(f"document.querySelector('details.folder[data-case=\"{A}\"]').open")
    check('7-1b', '點標題展開、再點收合', '展開後看到本階段必要待辦、等待其他角色、已完成工作；再點一次收合', o1 is True and '本階段必要待辦' in body and o2 is False)
    pg.click(f'details.folder[data-case="{A}"] > summary'); W(300)
    pg.click(f'details.folder[data-case="{A}"] li.task button >> nth=0'); W(600); pg_after = E("route.page")
    E("go('home')"); W(400); f1 = dict(folders())
    E("render(false)"); W(300); f2 = dict(folders())
    check('7-1c', '資料夾內按鈕正常、回來不會全部展開', '點資料夾內的操作按鈕會進入對應功能；回到工作清單只有剛才展開的張秀英保持展開，其他資料夾仍收合；重新渲染後狀態不變', pg_after in ('receipt', 'case', 'date') and f1.get(A) is True and all(not v for k, v in f1.items() if k != A) and f1 == f2, (pg_after, f1))
    pg.click(f'details.folder[data-case="{A}"] > summary'); W(200)
    pg.click('[data-act="work-tab"][data-tab="done"]'); W(300); fd = E("[...document.querySelectorAll('#doneList details.folder')].map(d => d.open)")
    pg.click('[data-act="work-tab"][data-tab="todo"]'); W(200)
    check('7-1d', '已完成分頁的資料夾也預設收合', '已完成分頁的個案資料夾全部收合', fd and not any(fd), fd)
    texts['staff_home'] = pg.text_content('main'); nav('case', A); texts['staff_case'] = pg.text_content('main'); nav('followup'); texts['staff_followup'] = pg.text_content('main')
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
    E("workTab = 'todo'; go('home')"); W(300); fn = folders()
    check('7-1e', '護理資料夾同樣預設收合', '護理工作台的資料夾全部收合', fn and all(not o for _, o in fn), fn)
    texts['nurse_home'] = pg.text_content('main')
    review(A, 'summary', ocr={'stype': '住院出院摘要', 'dx': '腦中風後遺症（右側無力）、高血壓', 'dc': '2026-11-04', 'tube': '鼻胃管', 'allergy': '磺胺類藥物（皮疹）', 'wound': '無'})
    o = store(f'ocrRuns/{I("summary")}__v1'); v = store('items/' + I('summary'))['versions'][0]
    check('N2', 'OCR 辨識及人工確認', 'OCR 結果另存（ocrRuns）；每欄人工確認後完成核對；欄位保留 AI 來源', o is not None and v.get('nurseOk') and v['fields']['tube'] == '鼻胃管' and st('summary') == '確認符合', (o and list(o.keys()), v.get('fields')))
    nav('review', I('meds')); pg.click('[data-act="review-return"]'); W(200); pg.select_option('#retReason', '文件模糊，看不清楚'); pg.fill('#retNote', '請重新拍攝清楚的帶藥明細'); pg.click('[data-act="modal-ok"]'); W(1500)
    check('N3', '補件退回：護理退回用藥清單', '狀態「需補件」，補件請求開啟中並記錄原因與期限', st('meds') == '需補件' and store('items/' + I('meds'))['req']['reason'] == '文件模糊，看不清楚')
    m = mails_for(I('meds')); rq = store('items/' + I('meds'))['req']; nq = [store(k) for k in keys('notices/') if store(k)['caseId'] == A and '用藥' in store(k)['text']]
    acc = store('accounts/family@example.com')
    check('7-5a', '正式補件產生系統通知與 Email 通知工作', '護理退回用藥清單：建立 1 筆系統通知與 1 筆 Email 通知工作，收件為申請人帳號 Email（不需手動填），狀態「模擬已寄送」，不宣稱已送達', len(m) == 1 and m[0]['to'] == acc['email'] and m[0]['status'] == '模擬已寄送' and len(m[0]['attempts']) == 1 and '未實際寄出' in m[0]['attempts'][0]['result'] and bool(nq), (len(m), m and m[0].get('attempts'), len(nq)))
    blob = json.dumps(m[0], ensure_ascii=False); cA = store('cases/' + A)
    check('7-5b', 'Email 內容與隱私', '包含案件編號、文件名稱、補件原因、期限與登入提醒；不含身分證字號、診斷、用藥內容或檢驗數值', m[0]['caseNo'] == 'C-0001' and m[0]['docName'] and m[0]['reason'] == rq['reason'] and m[0]['due'] == rq['due'] and '登入' in m[0]['action'] and cA['patient']['nid'] not in blob and '腦中風' not in blob and 'Aspirin' not in blob and 'mg' not in blob, list(m[0].keys()))
    E(f"syncReqMails(D.cases['{A}'])"); W(800); E(f"syncReqMails(D.cases['{A}'])"); W(800)
    check('7-5c', '同一補件事件不重複寄送', '再觸發兩次通知同步：仍只有 1 筆通知工作、1 次寄送；補件請求沒有重複', len(mails_for(I('meds'))) == 1 and len(mails_for(I('meds'))[0]['attempts']) == 1 and store('items/' + I('meds'))['req']['ts'] == rq['ts'] and not store('items/' + I('meds')).get('reqHistory'))
    review(A, 'tubeCare', fill={0: '鼻胃管 16Fr，右鼻孔 55 公分；每月更換（上次 11/01）；灌食後抬高床頭 30 度'})
    review(A, 'swallow', fill={0: '管灌，不可由口進食'})
    login('family@example.com'); t = main()
    check('F7', '家屬查看審核狀態與補件原因', '首頁列出「需要重新上傳」與退回原因；補件進度卡顯示正式補件（開啟中、尚未重新上傳）', '文件模糊，看不清楚' in t and '補件進度' in t and '尚未重新上傳' in pg.inner_text('#reqCard') and '開啟中' in pg.inner_text('#reqCard'))
    rc = pg.inner_text('#reqCard')
    check('7-4e', '補件進度顯示正式補件的完整資訊', '補件進度只列用藥清單：原因、要求時間、期限、開啟中、尚未重新上傳、審核結果、Email 通知狀態；沒有上傳按鈕（上傳在目前需要處理）', '目前用藥清單' in rc and '文件模糊' in rc and '要求時間' in rc and '期限' in rc and '開啟中' in rc and '尚未重新上傳' in rc and '審核結果' in rc and '模擬已寄送' in rc and E("document.querySelectorAll('#reqCard button').length") == 0 and '住民身分證明' not in rc, rc[:200])
    upload(A, 'meds', '04_用藥清單_張秀英')
    m = store('items/' + I('meds'))
    check('F8', '補件重新上傳', '新增第 2 版；狀態回到「待收件」，補件請求仍開啟（補傳不等於完成）；第 1 版保留', len(m['versions']) == 2 and st('meds') == '待收件' and not m['req'].get('closedAt') and bool(m['req'].get('uploadedAt')), (len(m['versions']), st('meds'), m['req']))
    nav('home', A); rc = pg.inner_text('#reqCard')
    check('7-4f', '重新上傳不等於補件完成', '補件進度顯示「已重新上傳（第 2 版）」，狀態仍是開啟中，補件請求沒有關閉', '已重新上傳（第 2 版' in rc and '開啟中' in rc and not store('items/' + I('meds'))['req'].get('closedAt'), rc[:200])
    login('staff@example.com'); nav('followup'); t = main()
    check('S11', '補件追蹤', '列出用藥清單的補件狀態', '目前用藥清單或處方資料' in t)
    receipt(A, 'meds', '1940/06/12')
    login('nurse@example.com'); review(A, 'meds', ocr={'meds': ['Aspirin 100 mg 每日一次 經鼻胃管', 'Amlodipine 5 mg 每日一次 早上'], 'note': '藥物磨粉後經鼻胃管給藥'})
    m = store('items/' + I('meds'))
    check('N4', '補件核對完成後關閉補件請求', '用藥清單確認符合，補件請求自動關閉', st('meds') == '確認符合' and bool(m['req'].get('closedAt')), m.get('req'))
    login('family@example.com'); nav('home', A); rc = pg.inner_text('#reqCard') if pg.query_selector('#reqCard') else ''
    check('7-4g', '護理確認問題已解決後才關閉', '用藥清單確認符合後，補件進度顯示「已關閉」；補件歷程與第 1、2 版保留', '已關閉' in rc and len(store('items/' + I('meds'))['versions']) == 2, rc[:150])
    login('nurse@example.com')
    login('nurse@example.com'); nav('resident', A); pg.fill('#hrRes-0', '已向家屬確認') if pg.query_selector('#hrRes-0') else None; pg.fill('#hrNote', '初審完成'); pg.click(f'[data-act="habit-review"][data-case="{A}"][data-state="審核完成"]'); W(1200)
    login('family@example.com'); nav('home', A); hrow = pg.text_content('#habitRow') if pg.query_selector('#habitRow') else ''
    check('7-2d', '護理初審完成後顯示審核完成', '習慣卡列在已完成，顯示「審核完成」', '審核完成' in hrow and E("!!document.querySelector('#grpDone #habitRow')"), hrow)
    login('nurse@example.com')
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
    cA = store('cases/' + A)
    check('7-7e', '已評估案件：保留歷史評估、摘要卡待重新確認', '家屬重新提交後，原評估結果保留；habitGate 不成立；案件「摘要卡待重新審核」，原因包含「生活與照護習慣卡（最新提交版本待護理確認）」', cA['assessment']['result'] == '收治' and E(f"habitGate(D.cases['{A}'])") is False and ph() == '摘要卡待重新審核' and '生活與照護習慣卡（最新提交版本待護理確認）' in E(f"cardChanged(D.cases['{A}'])"), E(f"cardChanged(D.cases['{A}'])"))
    login('nurse@example.com'); nav('card', A); cbk = main()
    check('7-7f', '新版習慣卡未確認前，摘要卡不使用新版內容', '摘要卡審核頁提示「最新提交版本尚未確認」，沒有表單；已開放的第 1 版摘要卡內容不變', '最新提交版本尚未確認' in cbk and pg.query_selector('#cardForm') is None and store('cases/' + A)['card']['v'] == 1, cbk[:120])
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
    E("window.__mailAdapterFail = false"); md = mails_for(I('diag', B)); dreq = store('items/' + I('diag', B))['req']
    nav('case', B); mc = pg.inner_text('#reqMailCard') if pg.query_selector('#reqMailCard') else ''
    check('7-5d', '寄送失敗會記錄並可重試，不顯示成功', '郵件服務模擬失敗：通知工作狀態「寄送失敗」、記錄失敗原因；行政案件頁顯示「寄送失敗，待重試」與重試按鈕', len(md) == 1 and md[0]['status'] == '寄送失敗' and md[0]['lastError'] and '寄送失敗' in mc and pg.query_selector(f'[data-act="reqmail-retry"][data-id="{md[0]["id"] if md else ""}"]') is not None, md and md[0].get('status'))
    pg.click('[data-act="reqmail-retry"]'); W(1200); md2 = mails_for(I('diag', B)); d2 = store('items/' + I('diag', B))
    check('7-5e', '重試成功且不重複建立補件要求', '重試後「模擬已寄送」、共 2 次嘗試；補件請求沒有新增（同一個建立時間、沒有補件歷程）；重試按鈕消失', len(md2) == 1 and md2[0]['status'] == '模擬已寄送' and len(md2[0]['attempts']) == 2 and d2['req']['ts'] == dreq['ts'] and not d2.get('reqHistory') and pg.query_selector('[data-act="reqmail-retry"]') is None, md2 and md2[0].get('attempts'))
    need(B, 'relProof', 'yes', '由女兒簽約')
    login('family2@example.com'); upload(B, 'relProof', '23_戶口名簿_陳金水'); upload(B, 'diag', '16_近期醫療摘要_陳金水')
    login('staff@example.com'); receipt(B, 'relProof', '民國 25 年 9 月 20 日', nid=False); receipt(B, 'diag', '1936/09/20')
    login('nurse2@example.com'); review(B, 'diag', fill={0: '失智症（輕度）、第二型糖尿病', 1: '2026-11-03'})
    check('S15', '確認補件狀態', '診斷證明確認符合、補件請求關閉；全部文件齊全後案件「待簽約」', st('diag', B) == '確認符合' and bool(store('items/' + I('diag', B))['req'].get('closedAt')) and ph(B) == '待簽約', (st('diag', B), ph(B)))
    E(f"window.__autoHabitSkip = ['{A}', '{B}']")
    login('family2@example.com'); nav('life', B, '4'); pg.fill('#habitForm [name=likeAct]', '唱客家山歌'); pg.click('#habitForm button[value="stay"]'); W(900); pg.click('[data-act="habit-submit"]'); W(1500)
    cb = store('cases/' + B); hv = cb['habit']['sub']['rev']; dv = cb['habitReview']['done']['rev']
    check('7-7a', '第 2 版習慣卡待初審時不能開始評估', '家屬提交新版本後：最新提交版本與審核版本不同，habitGate 不成立；案件停在文件審查中（不進入待簽約）；評估前置條件擋下；進度「機構審查」回到進行中', hv != dv and E(f"habitGate(D.cases['{B}'])") is False and ph(B) == '文件審查中' and E(f"stepsInfo(D.cases['{B}'])[2].state") == '進行中', (hv, dv, ph(B), E(f"habitGate(D.cases['{B}'])"), E(f"assessGuard(D.cases['{B}'])"), E(f"stepsInfo(D.cases['{B}'])[2]")))
    login('nurse2@example.com'); nav('resident', B); ch = pg.inner_text('#hrChanged') if pg.query_selector('#hrChanged') else ''
    check('7-7b', '只需重新確認變更的項目', '護理畫面只列出變更的「喜歡的活動」', '喜歡的活動' in ch and ch.count('→') == 1, ch)
    nav('assess', B); ab = main(); ag = E(f"assessGuard(D.cases['{B}'])")
    check('7-7c', '評估頁與送出前置條件一致', '承辦護理師開評估頁：顯示目前不能評估、沒有評估表單；送出前的檢查（assessGuard）同樣以習慣卡尚未完成初審擋下', '目前不能評估' in ab and pg.query_selector('#assessForm') is None and '習慣卡' in str(ag), ag)
    nav('resident', B); pg.fill('#hrNote', '確認新增的活動'); pg.click(f'[data-act="habit-review"][data-case="{B}"][data-state="審核完成"]'); W(1200)
    check('7-7d', '確認變更項目後恢復', '審核版本＝最新提交版本，案件回到待簽約', E(f"habitGate(D.cases['{B}'])") is True and store('cases/' + B)['habitReview']['done']['rev'] == store('cases/' + B)['habit']['sub']['rev'] and ph(B) == '待簽約', ph(B))
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
    login('care@example.com'); texts['care'] = pg.text_content('main')
    login('admin@example.com'); texts['admin'] = pg.text_content('main'); E("go('testdata')"); W(300); texts['admin_test'] = pg.text_content('main'); E("go('accounts')"); W(300); texts['admin_acc'] = pg.text_content('main')
    login('nurse@example.com'); nav('resident', A); texts['nurse_res'] = pg.text_content('main'); nav('assess', B); texts['nurse_assess'] = pg.text_content('main')
    login('staff@example.com'); nav('receipt', I('labs', B)); texts['staff_receipt_empty'] = pg.text_content('main'); nav('receipt', I('idcopy', B)); texts['staff_receipt'] = pg.text_content('main')
    bad = {k: elder(v)[:3] for k, v in texts.items() if k not in ('family_home',) and elder(v)}
    fh = [x for x in elder(texts['family_home'])]
    check('7-3b', '所有角色介面統一使用「住民」', '家屬（首頁、習慣卡、同意書、流程說明）、行政（工作清單、案件頁、補件追蹤、收件）、護理（工作台、住民資料、評估）、照服員、系統管理員畫面都沒有「長輩」（舊通知原文除外）', not bad and not fh, (bad, fh))
    check('7-3c', '文件顯示名稱由對照表產生，資料庫不改寫', '家屬與機構都看到「住民身分證明文件」「住民生活與照護習慣卡」；資料庫中舊文件名稱、規則說明原樣保留', '住民身分證明文件' in texts['guide'] and '住民生活與照護習慣卡' in texts['life'] and store('items/' + I('tubeCare'))['cond'].startswith('長輩'), store('items/' + I('tubeCare'))['cond'])
    check('Z1', '整個測試過程沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_seven.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
