"""六大項整合驗收（以兩種入住流程完整跑一次為主線，在各步驟插入六大項檢查）。原 run_s：內建文件清單、取消規則版本與改套、兩種入住流程完整跑一次、補件退回、選填未上傳、條件式不需要、寫入失敗。"""
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

    HTML_NOW = lambda: open('/home/claude/simp/index.html', encoding='utf-8').read()
    OKSEL = "[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"
    def logout():
        if pg.query_selector('[data-act="logout"]'): pg.click('[data-act="logout"]'); W(300); pg.wait_for_selector('#portal, #loginForm')
    def folder_tasks(c): return E(f"(() => {{ const f = document.querySelector('details.folder[data-case=\"{c}\"]'); return f ? [...f.querySelectorAll('li.task .what')].map(x => x.textContent) : null; }})()")
    def apply_new(name, nid, birth):
        nav('apply'); pg.fill('#applyForm [name=pname]', name); pg.fill('#applyForm [name=nid]', nid); pg.fill('#applyForm [name=birth]', birth); pg.fill('#applyForm [name=admit]', '2026-12-28')
        pg.click('#applyForm button[type=submit]'); W(500); pg.click('#applyPreviewForm button[type=submit]'); W(3000)
        return sorted([k.split('/')[1] for k in keys('cases/') if store(k)['patient']['name'] == name and store(k)['patient']['nid'] == nid])[-1]
    def hr(state, note='', res=None):
        nav('resident', A); W(200)
        if res is not None:
            for n, v in enumerate(res): pg.fill(f'#hrRes-{n}', v)
        pg.fill('#hrNote', note); clr(); pg.click(f'[data-act="habit-review"][data-state="{state}"]'); W(1200)

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

    # ================= 8.1 登入入口 =================
    logout(); E("go('login')"); W(300)
    pt = pg.inner_text('#portal'); n_btn = E("document.querySelectorAll('#portal .portal-btn').length")
    check('8.1-1', '入口只保留兩個選項', '只有「一般申請人」「機構工作人員」兩個入口；沒有重複的「我要申請入住」按鈕', n_btn == 2 and '一般申請人' in pt and '機構工作人員' in pt and '我要申請入住' not in pt and not pg.query_selector('#portal [data-act="want-apply"]'), pt[:200])
    pg.click('.portal-btn[data-arg="applicant"]'); W(300); t = pg.inner_text('main')
    check('8.1-2', '一般申請人登入畫面', '有電子郵件、密碼、登入、註冊帳號、忘記密碼、返回入口選擇；沒有新進人員申請', all(x in t for x in ['電子郵件', '密碼', '登入', '註冊一般申請人帳號', '忘記密碼', '返回入口選擇']) and '新進人員帳號申請' not in t, t[:200])
    pg.click('text=返回入口選擇'); W(300); pg.click('.portal-btn[data-arg="staff"]'); W(300); t = pg.inner_text('main')
    check('8.1-3', '機構工作人員登入畫面', '有電子郵件、密碼、登入、忘記密碼、返回入口選擇，以及「新進人員帳號申請」', all(x in t for x in ['電子郵件', '密碼', '登入', '忘記密碼', '返回入口選擇', '新進人員帳號申請']), t[:200])
    pg.fill('#loginForm [name=email]', 'family@example.com'); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); W(800)
    e1 = pg.inner_text('#loginErr'); in1 = bool(pg.query_selector('[data-act="logout"]'))
    E("go('login', 'applicant')"); W(200); pg.fill('#loginForm [name=email]', 'staff@example.com'); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); W(800)
    e2 = pg.inner_text('#loginErr'); in2 = bool(pg.query_selector('[data-act="logout"]'))
    check('8.1-4', '入口不授予權限', '申請人帳號從工作人員入口、工作帳號從申請人入口登入都被拒絕並提示改用正確入口；角色仍以帳號為準', (not in1) and (not in2) and '一般申請人' in e1 and '機構工作人員' in e2, (e1, e2))
    pg.set_viewport_size({'width': 390, 'height': 800}); E("go('login')"); W(400)
    geo = E("(() => { const b = [...document.querySelectorAll('#portal .portal-btn')].map(x => x.getBoundingClientRect()); return {stack: b[1].top >= b[0].bottom - 1, ovf: document.documentElement.scrollWidth > document.documentElement.clientWidth, w: b[0].width}; })()")
    E("go('login', 'staff')"); W(300); ovf2 = E("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    pg.set_viewport_size({'width': 1280, 'height': 900}); W(200)
    pg.set_viewport_size({'width': 1280, 'height': 900}); E("go('login')"); W(300)
    acc = lambda: E("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    rgb = lambda js: E(js)
    hexrgb = lambda h: 'rgb(%d, %d, %d)' % tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
    t_light = rgb("getComputedStyle(document.querySelector('.portal-btn .t')).color"); a_light = acc()
    pg.hover('.portal-btn[data-arg="staff"]'); W(200); hb_light = rgb("getComputedStyle(document.querySelector('.portal-btn[data-arg=staff]')).borderTopColor")
    pg.emulate_media(color_scheme='dark'); W(300); E("go('login')"); W(300)
    t_dark = rgb("getComputedStyle(document.querySelector('.portal-btn .t')).color"); a_dark = acc()
    pg.hover('.portal-btn[data-arg="applicant"]'); W(200); hb_dark = rgb("getComputedStyle(document.querySelector('.portal-btn[data-arg=applicant]')).borderTopColor")
    bg_dark = rgb("getComputedStyle(document.querySelector('.portal-btn[data-arg=staff]')).backgroundColor")
    pg.emulate_media(color_scheme='light'); pg.mouse.move(0, 0); W(200)
    check('F10-5', '入口卡片配色改用 --accent（淺色、深色、滑鼠懸停）', '程式中沒有 var(--brand)；標題文字與懸停邊框都等於當下的 --accent（淺色 #17607a、深色 #6fb8d2）；深色模式卡片背景不是白色', 'var(--brand)' not in HTML_NOW() and t_light == hexrgb(a_light) == hb_light and t_dark == hexrgb(a_dark) == hb_dark and a_light != a_dark and bg_dark != 'rgb(255, 255, 255)', (a_light, t_light, hb_light, a_dark, t_dark, hb_dark, bg_dark))
    check('8.1-5', '手機版版面（390px 寬）', '兩個入口上下排列、沒有水平捲動；登入頁也沒有水平捲動', geo['stack'] and not geo['ovf'] and not ovf2, (geo, ovf2))

    # ================= 8.2 個案資料夾（同名不同案） =================
    login('family3@example.com')
    s1 = apply_new('王同名', 'A123450001', '1945-01-01'); s2 = apply_new('王同名', 'A223450002', '1946-02-02')
    login('staff@example.com'); E("workTab = 'todo'; go('home')"); W(400)
    f1, f2 = folder_tasks(s1), folder_tasks(s2)
    check('8.2-1', '同名不同案分成兩個資料夾', '兩位「王同名」依案件編號分開，各自有一筆「確認新申請」', f1 is not None and f2 is not None and s1 != s2 and len(f1) == 1 and len(f2) == 1, (s1, s2, f1, f2))
    hd = pg.inner_text(f'details.folder[data-case="{s1}"] > summary')
    check('8.2-2', '資料夾外層資訊', '顯示姓名、案件編號、階段、待辦數', '王同名' in hd and E(f"D.cases['{s1}'].no") in hd and '待機構確認' in hd and '待辦 1' in hd, hd)
    pg.fill('#wbQ', '王同名'); W(700); nq = E("document.querySelectorAll('details.folder').length")
    no2 = E(f"D.cases['{s2}'].no"); pg.fill('#wbQ', no2); W(700); nq2 = E("[...document.querySelectorAll('details.folder')].map(d => d.dataset.case)")
    pg.fill('#wbQ', ''); W(700)
    check('8.2-3', '依姓名或案件編號搜尋', '搜尋「王同名」得 2 個資料夾；搜尋案件編號只剩 1 個', nq == 2 and nq2 == [s2], (nq, nq2))
    pg.select_option('#wbSort', 'count'); W(400); order = E("[...document.querySelectorAll('details.folder')].map(d => +(d.querySelector('summary').textContent.match(/待辦 (\\d+)/) || [0, 0])[1])")
    pg.select_option('#wbSort', 'recent'); W(300)
    check('8.2-4', '依待辦數量排序', '資料夾待辦數由多到少', order == sorted(order, reverse=True), order)
    nav('apply', s1); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500)
    E("go('home')"); W(400); f1b, f2b = folder_tasks(s1), folder_tasks(s2)
    check('8.2-5', '完成一件事只更新那一件', '確認第一位王同名後，只有他的「確認新申請」消失；另一位不受影響', not any('確認新申請' in x for x in (f1b or [])) and f2b == f2, (f1b, f2b))

    # ================= 8.4 個人資料同意書：非本人簽署 =================
    assign(s1, 'nurse@example.com')
    login('family3@example.com'); nav('consent', s1); t = main()
    check('8.4-1', '同意書流程與提示', '沒有登入密碼欄；有簽署身分四種選項、簽署人真實姓名、提示「本功能為電子同意流程示範，正式簽署及法律效力仍須確認。」', not pg.query_selector('#consentForm [name=pw]') and pg.query_selector('#consentForm [name=signerName]') is not None and E("[...document.querySelectorAll('#consentForm [name=signer]')].map(x => x.value)") == ['本人', '監護人', '代理人', '受輔助宣告'] and '本功能為電子同意流程示範，正式簽署及法律效力仍須確認。' in t)
    pg.check('input[name=signer][value="監護人"]'); pg.check('[name=agree]'); pg.click('#consentForm button[type=submit]'); W(800)
    check('8.4-2', '沒有填簽署人姓名不能送出', '顯示「請輸入簽署人真實姓名」，沒有寫入同意', '簽署人真實姓名' in pg.inner_text('#consentErr') and not store('cases/' + s1).get('consent'), pg.inner_text('#consentErr'))
    pg.fill('#consentForm [name=signerName]', '王監護'); pg.check('[name=photo]'); pg.click('#consentForm button[type=submit]'); W(2000)
    k = store('cases/' + s1)['consent']
    check('8.4-3', '監護人簽署：已提交、待代理權核實', '記錄簽署人姓名、身分、同意項目、版本、帳號、時間；狀態「待代理權核實」，授權尚未生效', k['state'] == '待代理權核實' and k['signerName'] == '王監護' and k['signer'] == '監護人' and k['items']['agree'] and k['items']['photo'] and k['ver'] and k['by'] == 'family3@example.com' and k['at'] and E(f"consentOk(D.cases['{s1}'])") is False and ph(s1) == '待代理權核實', k)
    gid = s1 + '_guardian'; sid = s1 + '_summary'
    nav('upload', s1, sid); blocked_med = not pg.query_selector('#uploadForm')
    check('8.4-4', '核實前醫療資料上傳仍受限制', '首頁提示待核實；出院摘要不能上傳；承辦護理師看不到文件', blocked_med and E(f"canProcess(D.cases['{s1}'])") is False and (nav('home', s1) or True) and pg.query_selector('#proofHero') is not None)
    upload(s1, 'guardian', '01_身分證影本_張秀英')
    check('8.4-5', '核實前可以上傳代理權證明', '監護宣告裁定書第 1 版上傳成功', len(store('items/' + gid)['versions']) == 1)
    login('staff@example.com'); tg = E(f"tasks().filter(t => t.c && t.c.id === '{s1}').map(t => t.tag)")
    nav('case', s1); dis = E("document.querySelector('[data-act=\"proof-ok\"]').disabled")
    check('8.4-6', '行政看到代理權待核實', '工作清單有「代理權」與證明文件收件；收件前「確認代理權」按鈕停用', '代理權' in tg and '收件' in tg and dis is True, (tg, dis))
    receipt(s1, 'guardian', '1945/01/01'); W(500)
    nav('case', s1); pg.click('[data-act="proof-ok"]'); W(600); e = pg.inner_text('#proofErr')
    pg.fill('#proofNote', '已核對監護宣告裁定書，監護人為王監護'); pg.click('[data-act="proof-ok"]'); W(1500)
    k = store('cases/' + s1)['consent']
    check('8.4-7', '行政核實後授權生效', '說明必填；核實後狀態「有效」並記錄核實人、時間、證明文件；同意歷程保留兩筆', '核實說明' in e and k['state'] == '有效' and k['proofCheck']['by'] == 'staff@example.com' and k['proofCheck']['itemId'] == gid and E(f"consentOk(D.cases['{s1}'])") is True and len(store('cases/' + s1)['consentHistory']) == 2, (e, k.get('state')))
    E(f"(async () => {{ const c = JSON.parse(JSON.stringify(window.__store.get('cases/{s1}'))); c.consent = {{signer:'監護人', at:'2026/11/03 21:00', ver:1, by:'family3@example.com', needsProof:true, photo:false, emergency:true}}; await db.doc('cases/{s1}').set(c); }})()"); W(1200)
    legacy = E(f"consentState(D.cases['{s1}'])"); gchk = bool(store('items/' + gid)['versions'][-1].get('idCheck'))
    nav('case', s1); lcard = pg.query_selector('#proofCard') is not None
    check('F10-2a', '舊資料：證明文件已收件核對但沒有代理權核實紀錄', '舊格式監護人簽署（沒有 state），裁定書已完成收件核對，仍是「待代理權核實」、授權不生效；案件頁出現代理權核實卡', gchk and legacy == '待代理權核實' and E(f"consentOk(D.cases['{s1}'])") is False and lcard, (gchk, legacy, lcard))
    pg.fill('#proofNote', '舊案件補做代理權核實：已核對裁定書正本'); pg.click('[data-act="proof-ok"]'); W(1500); k = store('cases/' + s1)['consent']
    check('F10-2b', '舊資料補做獨立的代理權核實', '行政核實後才變成「有效」，記錄核實人與證明文件', k.get('state') == '有效' and k['proofCheck']['result'] == '代理權已確認' and k['proofCheck']['itemId'] == gid and E(f"consentOk(D.cases['{s1}'])") is True, k)
    lv2 = E("consentState({id:'X', consent:{signer:'監護人', needsProof:true, proofOk:true, proofCheck:{result:'代理權已確認'}}})"); lv3 = E("consentState({id:'X', consent:{signer:'本人', needsProof:false}})")
    check('F10-2c', '舊資料判斷規則（程式層級）', '舊資料有獨立核實紀錄 → 有效；舊本人簽署 → 有效', lv2 == '有效' and lv3 == '有效', (lv2, lv3))
    # 代理人簽署 → 無法核實 → 重新以本人簽署
    nav('apply', s2); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(s2, 'nurse@example.com')
    login('family3@example.com'); nav('consent', s2); pg.check('input[name=signer][value="代理人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '李代理'); pg.click('#consentForm button[type=submit]'); W(2000)
    ap = store('items/' + s2 + '_agentProof')
    check('8.4-8', '其他代理人簽署', '狀態「待代理權核實」，系統建立「代理權授權證明」待上傳', store('cases/' + s2)['consent']['state'] == '待代理權核實' and ap is not None and ap['name'] == '代理權授權證明')
    login('staff@example.com'); nav('case', s2); pg.fill('#proofNote', '申請人無法提供授權書'); pg.click('[data-act="proof-fail"]'); W(1500)
    check('8.4-9', '代理權無法核實', '狀態「代理權未通過」，案件回到「待同意」，授權不生效', store('cases/' + s2)['consent']['state'] == '代理權未通過' and ph(s2) == '待同意' and E(f"consentOk(D.cases['{s2}'])") is False)
    login('family3@example.com'); nav('consent', s2); t = main()
    pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '王同名'); pg.click('#consentForm button[type=submit]'); W(2000)
    c2 = store('cases/' + s2)
    login('staff@example.com'); nav('case', s2); crow = E("[...document.querySelectorAll('main th')].find(t => t.textContent === '資料授權').nextElementSibling.textContent")
    check('F10-2d', '本人簽署標示為原型流程', '案件頁資料授權顯示「原型流程：本人簽署未做正式身分驗證，法律效力尚待確認」', '原型流程' in crow and '法律效力尚待確認' in crow, crow[:150])
    check('8.4-10', '重新以本人簽署', '顯示上次未通過原因；本人簽署後立即有效；前一次簽署保留在 consentPrev 與歷程', '無法核實' in t and c2['consent']['state'] == '有效' and c2['consent']['signer'] == '本人' and len(c2.get('consentPrev', [])) == 1 and len(c2['consentHistory']) == 3, (c2['consent'].get('state'), len(c2.get('consentHistory', []))))


    # ================= 先審後簽：張秀英 =================
    login('staff@example.com'); confirm_apply(A, 'nurse@example.com')
    check('S1', '行政確認申請', '已確認、指定黃護理師；文件清單沿用申請時建立的 24 份（不重建）；家屬收到通知', store('cases/' + A)['linkStatus'] == '已確認' and len([k for k in keys('items/') if k.startswith('items/' + A + '_')]) == 24 and any(store(k)['caseId'] == A for k in keys('notices/')))
    login('family@example.com'); consent(A)
    check('S2', '家屬簽署資料授權（沿用線上簽署）', '授權有效；個資同意列在 E 類為線上簽署，沒有另外的上傳項目', E(f"consentOk(D.cases['{A}'])") and '個人資料蒐集、處理及利用同意書（線上簽署）' in (to_guide() or pg.text_content('#docList')) and not any('個人資料' in store(k)['name'] for k in keys('items/' + A)))
    nav('contacts', A); pg.fill('#contactForm [name=name0]', '張家豪'); pg.fill('#contactForm [name=rel0]', '兒子'); pg.fill('#contactForm [name=phone0]', '0912-300-111'); pg.click('#contactForm button[type=submit]'); W(800)
    nav('home', A); g = pg.inner_text('#docGroups'); pend = pg.inner_text('#grpPend') if pg.query_selector('#grpPend') else ''
    later_open = E("(() => { const d = document.getElementById('grpLater'); return d ? d.tagName + ':' + d.open : ''; })()")
    check('8.6-1', '家屬端依階段顯示', '顯示目前階段；管路照護等標示「待護理判斷」且說明不是缺件；下一階段預告收合', '目前階段' in g and '待護理判斷' in pend and '管路照護資料' in pend and '不是您的缺件' in pend and later_open == 'DETAILS:false' and not E(f"familyTodo(D.items['{I('tubeCare')}'], D.cases['{A}'])"), (pend[:120], later_open))

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
    E(f"window.__autoHabitSkip = ['{A}']"); hab_submit(A)
    # 行政收件與出生日期比對
    login('staff@example.com'); E("workTab = 'todo'; wbQ = ''; go('home')"); W(400)
    E("document.querySelectorAll('details.folder').forEach(d => d.open = true)"); fb = pg.inner_text(f'details.folder[data-case="{A}"]'); ft0 = folder_tasks(A); nA = E(f"tasks().filter(t => t.c && t.c.id === '{A}' && !t.opt).length")
    later_closed = E(f"[...document.querySelectorAll('details.folder[data-case=\"{A}\"] .fbody > details')].every(d => !d.open)")
    check('8.2-6', '行政資料夾展開內容', '本階段必要待辦、正在等待其他角色處理、下一階段預告（收合、不計入待辦）、已完成工作、完整個案資料', all(x in fb for x in ['本階段必要待辦', '正在等待其他角色處理', '下一階段預告', '已完成工作', '完整個案資料']) and later_closed and f'待辦 {nA}' in fb, fb[:300])
    nav('receipt', I('idcopy')); pg.fill('#birthRaw', '民國 30 年 6 月 12 日'); W(200); bad = pg.inner_text('#birthCmp')
    pg.fill('#birthRaw', '民國 29 年 6 月 12 日'); W(200); good = pg.inner_text('#birthCmp')
    check('S9', '出生日期逐項比對', '民國 30 年 → 顯示不一致；民國 29 年 6 月 12 日 → 轉為 1940/06/12 一致', '不一致' in bad and '1940/06/12' in good and '一致' in good and '不一致' not in good, (bad[:60], good[:60]))
    receipt(A, 'idcopy', '民國 29 年 6 月 12 日'); E("go('home')"); W(300); ft1 = folder_tasks(A)
    check('8.2-7', '完成收件只移除該任務', '張秀英資料夾只少了身分證明的收件任務，其他任務不變', [x for x in ft0 if '住民身分證明文件' not in x] == ft1, (ft0, ft1))
    receipt(A, 'nhi', '029/06/12'); receipt(A, 'summary', '1940/06/12'); receipt(A, 'meds', '1940/06/12'); receipt(A, 'tubeCare', '民國 29 年 06 月 12 日', nid=False); receipt(A, 'swallow', '1940/06/12')
    v = store('items/' + I('nhi'))['versions'][0]
    check('S10', '行政收件核對', '非醫療文件（身分證、健保卡）確認符合；醫療文件轉「待護理核對」；出生日期比對結果有保存', st('idcopy') == '確認符合' and st('nhi') == '確認符合' and all(st(k) == '待護理核對' for k in ['summary', 'meds', 'tubeCare', 'swallow']) and (v.get('idCheck') or {}).get('birth', {}).get('result') == '一致', (st('idcopy'), v.get('idCheck')))
    # 護理：OCR、退回補件
    login('nurse@example.com')
    check('N1', '護理只看醫療文件', '身分證、健保卡不能由護理查看；工作清單只有 4 份醫療文件核對', E(f"nurseCanSee(D.items['{I('idcopy')}'])") is False and E("tasks().filter(t => t.tag === '核對').length") == 4)
    E("workTab = 'todo'; go('home')"); W(300)
    nf = E("[...document.querySelectorAll('details.folder')].map(d => d.dataset.case)")
    check('8.2-8', '護理資料夾只列自己負責的住民', '張秀英在護理資料夾中；其他護理師的案件不列出', A in nf and all(E(f"D.cases['{x}'].nurseId") == 'nurse@example.com' for x in nf), nf)
    nav('review', I('summary')); E("window.__ocrNext = " + json.dumps({'stype': '住院出院摘要', 'dx': '腦中風後遺症（右側無力）、高血壓', 'dc': '2026-11-04', 'tube': '鼻胃管', 'allergy': '磺胺類藥物（皮疹）', 'wound': '無'}, ensure_ascii=False)); pg.click('#ocrBtn'); W(1500)
    dxi = E("reviewState.fields.findIndex(f => f.k === 'dx')"); rows = lambda: E(f"reviewState.fields[{dxi}].rows.map(r => [r.state, r.text, r.src])")
    r0 = rows(); prog = pg.inner_text('#dxField')
    check('8.3-1', 'AI 辨識結果不會自動確認', '原文整段成為 1 筆「待確認」；進度「診斷已確認 0／1 項」；欄位沒有一般「確認」按鈕', len(r0) == 1 and r0[0][0] == '待確認' and r0[0][2].startswith('AI') and '診斷已確認 0／1 項' in prog and not pg.query_selector('#dxField [data-act="f-ok"]'), (r0, prog[:120]))
    for _ in range(20):
        if not pg.query_selector('[data-act="f-ok"]'): break
        pg.click('[data-act="f-ok"] >> nth=0'); W(60)
    check('8.3-2', '診斷未確認時不能完成文件核對', '其他欄位都確認後，「完成核對」仍停用', E("document.querySelector('[data-act=\"review-done\"]').disabled") is True)
    pg.click('[data-act="dxr-reject"][data-r="0"]'); W(200); pg.select_option('#dxRej', '拆分錯誤'); pg.click('[data-act="modal-ok"]'); W(600)
    pg.click('[data-act="dxr-split"]'); W(600); r1 = rows()
    check('8.3-3', '整段標示不採用、再依標點拆成建議', '原本那筆保留為「不採用」（含理由）；新增 2 筆「待確認」拆分建議；進度 0／2', [x[0] for x in r1] == ['不採用', '待確認', '待確認'] and all('拆分建議' in x[2] for x in r1[1:]) and E(f"reviewState.fields[{dxi}].rows[0].reason") == '拆分錯誤' and '診斷已確認 0／2 項' in pg.inner_text('#dxField'), r1)
    pg.click('[data-act="dxr-split"]'); W(600); e4 = pg.inner_text(f'#fe-{dxi}'); n4 = len(rows())
    pg.click('[data-act="dxr-fromraw"]'); W(600); e5 = pg.inner_text(f'#fe-{dxi}'); n5 = len(rows())
    check('F10-4a', '再按一次「拆成多筆建議」或「原文整段加入」不會重複', '提示已在清單中，列數維持 3；原文整段提示已在第 1 筆（不採用），請用恢復為待確認', '都已經在清單中' in e4 and n4 == 3 and '第 1 筆' in e5 and '恢復為待確認' in e5 and n5 == 3, (e4, e5, n4, n5))
    part = E("(() => { const f = {rows:[{n:1, raw:'腦中風', text:'腦中風', state:'已確認'}, {n:2, raw:'高 血壓', text:'高血壓（原發性）', state:'待確認'}]}; return [!!dxDup(f, ' 腦中風 '), !!dxDup(f, '高血壓'), !!dxDup(f, '高血壓（原發性）'), !!dxDup(f, '糖尿病')]; })()")
    check('F10-4b', '重複比對規則（程式層級）', '忽略空白比對原始文字與人工修正後文字；新診斷不算重複', part == [True, True, True, False], part)
    pg.click('[data-act="dxr-ok"][data-r="1"]'); W(600)
    check('8.3-4', '逐筆確認進度', '確認第 1 筆後顯示「診斷已確認 1／2 項」，完成核對仍停用', '診斷已確認 1／2 項' in pg.inner_text('#dxField') and E("document.querySelector('[data-act=\"review-done\"]').disabled") is True)
    pg.fill(f'#dxt-{dxi}-2', '高血壓（原發性）'); pg.click('[data-act="dxr-ok"][data-r="2"]'); W(600)
    pg.click('[data-act="dxr-undo"][data-r="2"]'); W(600); st2 = E(f"reviewState.fields[{dxi}].rows[2].state"); h2 = E(f"reviewState.fields[{dxi}].rows[2].hist.map(h => h.act)")
    pg.click('[data-act="dxr-ok"][data-r="2"]'); W(800)
    check('8.3-5', '修改、退回待確認、再確認', '核對後文字可修改；「改回待確認」後狀態回到待確認並留下歷程；再確認後 2／2', st2 == '待確認' and '改回待確認' in h2 and '修改（未確認）' in h2 and '診斷已確認 2／2 項' in pg.inner_text('#dxField') and E("document.querySelector('[data-act=\"review-done\"]').disabled") is False, (st2, h2))
    W(800); nav('home'); nav('review', I('summary')); r2 = rows()
    check('8.3-6', '逐筆核對存在草稿', '離開再回來，3 筆診斷與狀態都還在（從草稿還原）', [x[0] for x in r2] == ['不採用', '已確認', '已確認'] and r2[2][1] == '高血壓（原發性）', r2)
    E(f"(() => {{ const st = window.__store, o = st.set.bind(st); st.set = (k, v) => {{ if (k === 'cases/{A}' && window.__blockCase) throw {{code:'unavailable'}}; return o(k, v); }}; window.__blockCase = true; }})()")
    clr(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=20000); W(800); E("window.__blockCase = false"); tmsg = toasts()
    v0 = store('items/' + I('summary'))['versions'][0]; dg0 = len(store('cases/' + A).get('diagnoses') or [])
    lg = [store(k)['what'] for k in keys('logs/') if store(k).get('caseId') == A]
    check('F10-1a', '病摘核對寫入成功、診斷同步失敗', '核對結果保留（nurseOk、dxRows 3 筆）；個案診斷清單沒有寫入；提示同步失敗；操作紀錄有「診斷清單同步失敗」', v0.get('nurseOk') and len(v0['dxRows']['rows']) == 3 and dg0 == 0 and '同步失敗' in tmsg and any('診斷清單同步失敗' in x for x in lg), (tmsg[:120], dg0))
    tk = E(f"tasks().filter(t => t.c.id === '{A}').map(t => t.tag)"); nav('resident', A); box = pg.inner_text('#dxSyncBox') if pg.query_selector('#dxSyncBox') else ''
    check('F10-1b', '同步未完成有明確狀態', '護理工作有「診斷同步未完成」；住民頁顯示缺 2 筆與「重試同步診斷」；摘要卡開放條件不成立', '診斷' in tk and '缺 2 筆' in box and pg.query_selector('[data-act="dx-resync"]') is not None and E(f"dxPending(D.cases['{A}']) !== null"), (tk, box[:120]))
    pg.click('[data-act="dx-resync"]'); W(1500); dg1 = store('cases/' + A)['diagnoses']
    E(f"retryDxSync(D.cases['{A}'])"); W(800); E(f"syncDiagnoses(D.items['{I('summary')}'], 1, D.items['{I('summary')}'].versions[0].dxRows.rows)"); W(800); dg2 = store('cases/' + A)['diagnoses']
    lg = [store(k)['what'] for k in keys('logs/') if store(k).get('caseId') == A]
    check('F10-1c', '重試同步且不重複新增', '按「重試同步診斷」後補入 2 筆、狀態消失；再重試兩次仍是 2 筆；操作紀錄有「診斷清單同步完成」', len(dg1) == 2 and len(dg2) == 2 and E(f"dxPending(D.cases['{A}'])") is None and not pg.query_selector('#dxSyncBox') and any('診斷清單同步完成' in x for x in lg), (len(dg1), len(dg2)))
    v = store('items/' + I('summary'))['versions'][0]; cA = store('cases/' + A); dxs = [d for d in cA.get('diagnoses', []) if d['state'] == '已確認']
    check('8.3-7', '完成核對：保存逐筆結果並同步診斷清單', 'v.dxRows 保存 3 筆（含不採用）；欄位值為兩筆已確認診斷；個案診斷清單 2 筆已確認，來源為出院摘要第 1 版', len(v['dxRows']['rows']) == 3 and v['fields']['dx'] == '腦中風後遺症（右側無力）、高血壓（原發性）' and len(dxs) == 2 and all(d['src']['itemId'] == I('summary') and d['src']['v'] == 1 for d in dxs) and E(f"dxText(D.cases['{A}'])") == '腦中風後遺症（右側無力）、高血壓（原發性）', (v.get('dxRows'), dxs))
    oldd = E("(() => { const f = dxNormalize({type:'dxlist', k:'dx', val:'腦中風、高血壓', ok:true, okBy:'x', auto:false}); return [f.rows.length, f.rows[0].state, f.ok]; })()")
    sup = E("confirmedDx({diagnoses:[{state:'已確認', raw:'舊', superseded:true}, {state:'已確認', raw:'新'}]}).map(d => d.raw)")
    check('8.3-8', '舊資料相容（程式層級檢查）', '舊格式已確認的整段文字只轉成 1 筆「待確認」，不自動拆分、不自動確認；已被新版取代的診斷不列入已確認', oldd == [1, '待確認', False] and sup == ['新'], (oldd, sup))

    o = store(f'ocrRuns/{I("summary")}__v1'); v = store('items/' + I('summary'))['versions'][0]
    check('N2', 'OCR 辨識及人工確認', 'OCR 結果另存（ocrRuns）；每欄人工確認後完成核對；欄位保留 AI 來源', o is not None and v.get('nurseOk') and v['fields']['tube'] == '鼻胃管' and st('summary') == '確認符合', (o and list(o.keys()), v.get('fields')))
    nav('review', I('meds')); pg.click('[data-act="review-return"]'); W(200); pg.select_option('#retReason', '文件模糊，看不清楚'); pg.fill('#retNote', '請重新拍攝清楚的帶藥明細'); pg.click('[data-act="modal-ok"]'); W(1500)
    check('N3', '補件退回：護理退回用藥清單', '狀態「需補件」，補件請求開啟中並記錄原因與期限', st('meds') == '需補件' and store('items/' + I('meds'))['req']['reason'] == '文件模糊，看不清楚')
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
    login('nurse@example.com'); review(A, 'meds', ocr={'meds': ['Aspirin 100 mg 每日一次 經鼻胃管', 'Amlodipine 5 mg 每日一次 早上'], 'note': '藥物磨粉後經鼻胃管給藥'})
    m = store('items/' + I('meds'))
    check('N4', '補件核對完成後關閉補件請求', '用藥清單確認符合，補件請求自動關閉', st('meds') == '確認符合' and bool(m['req'].get('closedAt')), m.get('req'))
    check('F9', '選填文件未上傳不阻擋；習慣卡未初審時不進入評估（八大項）', '選填文件未上傳不影響；必要文件都確認後，因習慣卡已提交但尚未護理初審，案件停在「文件審查中」，不會進入「評估中」', ph() == '文件審查中' and E(f"docsReady(D.cases['{A}'])") is True and E(f"assessGuard(D.cases['{A}'])") != True, ph())
    hs = lambda: E(f"habitState(D.cases['{A}'])"); hrS = lambda: store('cases/' + A).get('habitReview')
    t5 = E(f"tasks().filter(t => t.c.id === '{A}' && t.tag === '習慣卡').map(t => [t.opt, t.why])")
    check('8.5-1', '家屬正式提交後為「待審核」（八大項：必要待辦）', '習慣卡狀態「待審核」；護理資料夾有「生活與照護習慣卡初審」，列為必要待辦（不是選填）', hs() == '待審核' and len(t5) == 1 and not t5[0][0] and '收治評估' in t5[0][1], (hs(), t5))
    E("workTab = 'todo'; wbQ = ''; go('home')"); W(400); fdA = f'details.folder[data-case="{A}"]'
    E("document.querySelectorAll('details.folder').forEach(d => d.open = true)"); sm = pg.inner_text(fdA + ' > summary'); nreq = E(f"document.querySelectorAll('{fdA} .fbody > ul.tasks')[0] ? document.querySelectorAll('{fdA} .fbody > ul.tasks')[0].children.length : 0"); body = pg.inner_text(fdA + ' .fbody')
    nN = E(f"tasks().filter(t => t.c.id === '{A}' && !t.opt).length"); tab = pg.inner_text('[data-act="work-tab"][data-tab="todo"]')
    check('F10-3', '資料夾內外數量一致（八大項：習慣卡初審改為必要待辦）', f'外層「必要待辦 {nN}」、沒有選填／提醒；展開後「本階段必要待辦（{nN}）」包含習慣卡初審；分頁數量一致', f'必要待辦 {nN}' in sm and '選填／提醒' not in sm and f'本階段必要待辦（{nN}）' in body and '生活與照護習慣卡初審' in body and nreq == nN and f'（{E("tasks().filter(t => !t.opt).length")}）' in tab, (sm, nreq, tab))
    hr('審核完成'); e = pg.inner_text('#hrErr')
    check('8.5-2', '有不一致未處理時不能完成', '家屬過敏「海鮮」與已確認過敏不同；沒有處理說明時被擋下，資料沒有寫入', '沒有處理說明' in e and not (hrS() or {}).get('done'), e)
    hr('護理已閱')
    check('8.5-3', '護理已閱只是閱讀紀錄', '寫入一筆「護理已閱」，狀態仍是「待審核」', hrS()['hist'][-1]['state'] == '護理已閱' and hs() == '待審核', (hs(), hrS()))
    hr('有疑義'); e1 = pg.inner_text('#hrErr'); hr('有疑義', '海鮮過敏與病摘不同，待家屬確認')
    check('8.5-4', '標示有疑義／待確認', '說明必填；標示後狀態「有疑義／待確認」', '請說明' in e1 and hs() == '有疑義／待確認', (e1, hs()))
    nav('resident', A); pg.fill('#hrRes-0', '已電話確認：海鮮為食物不耐，以醫院紀錄為準'); pg.fill('#hrNote', '已與家屬確認'); fail('cases/'); clr(); pg.click('[data-act="habit-review"][data-state="審核完成"]'); W(1500); fail(None)
    check('8.5-5', '寫入失敗不顯示成功', '顯示「儲存失敗」；沒有「已完成習慣卡審核」提示；狀態仍是有疑義', '儲存失敗' in pg.inner_text('#hrErr') and '已完成習慣卡審核' not in toasts() and hs() == '有疑義／待確認', pg.inner_text('#hrErr'))
    clr(); pg.click('[data-act="habit-review"][data-state="審核完成"]'); W(1500); d = hrS()['done']
    check('8.5-6', '確認習慣卡審核完成', '成功後才提示；記錄案件、習慣卡版本（家屬修改次數）、審核者、時間、結果、說明與不一致處理說明', '已完成習慣卡審核' in toasts() and hs() == '審核完成' and d['by'] == 'nurse@example.com' and d['rev'] == store('cases/' + A)['habit']['rev'] and d['at'] and d['diffRes'][0]['res'] and d['snap']['call'] == '秀英阿嬤' and hrS()['hist'][-1]['state'] == '審核完成', d)
    check('8.5-7', '完成後不重複產生任務；家屬資料不覆蓋醫療資料；不開放摘要卡', '沒有習慣卡任務；已確認過敏仍是磺胺類藥物；沒有開放摘要卡', E(f"tasks().filter(t => t.c.id === '{A}' && t.tag === '習慣卡').length") == 0 and '磺胺' in E(f"confirmedField(D.cases['{A}'], 'allergy')") and not store('cases/' + A).get('card'))
    sim = E(f"(() => {{ const c = JSON.parse(JSON.stringify(D.cases['{A}'])); c.habitReview.done.med.allergy = '（模擬）舊的已確認過敏'; return [habitState(c), habitChanges(c).med.map(x => x.label), habitChanges(c).fam.length]; }})()")
    check('8.5-8', '已確認醫療資料變更也會標示（以程式模擬）', '模擬審核當時的已確認過敏不同 → 「資料已變更，需重新確認」，只列「已確認醫療資料：過敏」', sim == ['資料已變更，需重新確認', ['已確認醫療資料：過敏'], 0], sim)

    nav('assess', A); t = main()
    check('8.3-9', '評估頁讀取多筆已確認診斷', '評估頁主要診斷顯示兩筆已確認診斷', '腦中風後遺症（右側無力）、高血壓（原發性）' in t)
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
    E(f"(async () => {{ const c = JSON.parse(JSON.stringify(window.__store.get('cases/{A}'))); c.diagnoses = c.diagnoses.slice(1); await db.doc('cases/{A}').set(c); }})()"); W(1200)
    ca = E(f"cardAllowed(D.cases['{A}'])"); tk = E(f"tasks().filter(t => t.c.id === '{A}').map(t => t.tag)"); nav('card', A); tc = main()
    check('F10-1d', '摘要卡階段發現診斷清單不一致', '（以直接改資料模擬清單缺一筆）摘要卡開放條件不成立；工作清單改列「診斷同步未完成」而非審核摘要卡；摘要卡頁不顯示表單，提示重試', ca is False and '診斷' in tk and '摘要卡' not in tk and '診斷清單同步未完成' in tc and not pg.query_selector('#cardForm'), (ca, tk))
    pg.click('[data-act="dx-resync"]'); W(1500); nav('card', A)
    check('F10-1e', '重試後恢復摘要卡審核', '診斷清單回到 2 筆，摘要卡表單出現', len(store('cases/' + A)['diagnoses']) == 2 and pg.query_selector('#cardForm') is not None)
    hn = pg.inner_text('#cardHabitNote') if pg.query_selector('#cardHabitNote') else ''
    check('8.5-9', '摘要卡沿用審核完成的習慣卡', '摘要卡審核頁顯示「已沿用審核完成的習慣卡」，不要求重新審核習慣卡；A 區主要健康問題為兩筆已確認診斷', '已沿用審核完成的習慣卡' in hn and pg.input_value('#cardForm [name=dx]') == '腦中風後遺症（右側無力）、高血壓（原發性）', (hn, pg.input_value('#cardForm [name=dx]')))
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
    ch = E(f"habitChanges(D.cases['{A}']).fam.map(x => x.label)")
    check('8.5-10', '家屬修改後只需重新確認變更項目', '狀態「資料已變更，需重新確認」，只列出「喜歡的活動」這一項', hs() == '資料已變更，需重新確認' and len(ch) == 1, (hs(), ch))

    login('care@example.com'); nav('card', A); t = main()
    check('C4', '照服員看到資料更新提示', '顯示「資料已更新，需重新確認」，受影響欄位顯示「請問護理站」', '資料已更新' in t, t[:200])
    login('nurse@example.com'); hr('審核完成', '確認新增的活動偏好')
    check('8.5-11', '重新確認後回到審核完成', '歷程記錄這次重新確認的項目；狀態「審核完成」', hs() == '審核完成' and len(hrS()['hist'][-1].get('changed', [])) == 1, hrS()['hist'][-1])
    nav('resident', A); pg.click('[data-act="card-revise"]'); W(1200); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    cc = store('cases/' + A)
    check('N10', '護理更新並重新確認摘要卡', '第 2 版開放，第 1 版保留在歷史；案件回到「摘要卡已開放」', cc['card']['v'] == 2 and len(cc.get('cardHistory', [])) == 1 and ph() == '摘要卡已開放' and '聽歌仔戲' in cc['card'].get('prefs', ''), (cc['card']['v'], ph()))

    check('8.5-12', '摘要卡記錄沿用的習慣卡審核版本', '第 2 版摘要卡記錄習慣卡「審核完成」', store('cases/' + A)['card'].get('habitReviewRef', {}).get('state') == '審核完成', store('cases/' + A)['card'].get('habitReviewRef'))

    # ================= 先簽後審：陳金水 =================
    login('staff@example.com'); confirm_apply(B, 'nurse2@example.com')
    login('family2@example.com'); consent(B)
    t = (to_guide() or pg.text_content('#docList'))
    check('P1', '先簽後審：一開始就要求全部文件', '入住契約、體檢報告等入住前文件也列入目前要上傳', E(f"activeItems(D.cases['{B}']).some(i => i.key === 'contract')") is True)
    nav('home', B); g = pg.inner_text('#docGroups')
    check('8.6-2', '先簽後審家屬端', '評估前與入住前文件同時列出並分段標示；沒有「下一階段預告」', '評估前文件' in g and '入住前文件（目前需要準備）' in g and not pg.query_selector('#grpLater'), g[:200])

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
    login('staff@example.com'); nav('case', B); pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("diag", B)}"]'); pg.fill('#srNote', '請補診斷證明，確認失智症診斷'); pg.click('[data-act="modal-ok"]'); W(1500)
    d = store('items/' + I('diag', B))
    check('S14', '行政發出補件通知', '選填的診斷證明改為「需要繳交」、補件請求開啟；家屬收到通知', d['need'] == '必備' and d['req'] and any('診斷證明' in store(k)['text'] for k in keys('notices/') if store(k)['caseId'] == B))
    need(B, 'relProof', 'yes', '由女兒簽約')
    login('family2@example.com'); upload(B, 'relProof', '23_戶口名簿_陳金水'); upload(B, 'diag', '16_近期醫療摘要_陳金水')
    login('staff@example.com'); receipt(B, 'relProof', '民國 25 年 9 月 20 日', nid=False); receipt(B, 'diag', '1936/09/20')
    login('nurse2@example.com'); review(B, 'diag', fill={0: '失智症（輕度）、第二型糖尿病', 1: '2026-11-03'})
    check('S15', '確認補件狀態', '診斷證明確認符合、補件請求關閉；全部文件齊全後案件「待簽約」', st('diag', B) == '確認符合' and bool(store('items/' + I('diag', B))['req'].get('closedAt')) and ph(B) == '待簽約', (st('diag', B), ph(B)))
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
    login('staff@example.com'); pg.click('[data-act="work-tab"][data-tab="done"]'); W(400)
    dc = E("[...document.querySelectorAll('#doneList details.folder')].map(d => d.dataset.case)")
    check('8.2-9', '已完成分頁依個案分組', '張秀英、陳金水各一個資料夾，不重複', A in dc and B in dc and len(dc) == len(set(dc)), dc)
    pg.click('[data-act="work-tab"][data-tab="todo"]'); W(200)
    login('nurse@example.com'); nav('assign'); pg.click(f'[data-act="assign-nurse"][data-case="{A}"]'); W(200); pg.select_option('#asNurse', 'nurse2@example.com'); pg.fill('#asReason', '人力調整'); pg.click('[data-act="modal-ok"]'); W(1500)
    E("workTab = 'todo'; go('home')"); W(300); todoF = E("[...document.querySelectorAll('details.folder')].map(d => d.dataset.case)")
    pg.click('[data-act="work-tab"][data-tab="done"]'); W(400); dn = pg.inner_text(f'#doneList details.folder[data-case="{A}"]') if pg.query_selector(f'#doneList details.folder[data-case="{A}"]') else ''
    pg.click('[data-act="work-tab"][data-tab="todo"]'); W(200)
    check('8.2-10', '重新分配後原護理師只保留摘要', '張秀英不在待處理資料夾；已完成資料夾標示「已移交」，沒有住民資料入口；不能開啟住民頁', A not in todoF and '已移交' in dn and '完整住民資料' not in dn and E(f"D.cases['{A}'].nurseId") == 'nurse2@example.com', (todoF, dn[:150]))
    login('staff@example.com'); E("go('home')"); W(300)
    check('8.2-11', '行政不因工作台取得分配或醫療權限', '行政畫面沒有分配護理師按鈕，也不能開啟醫療文件核對', not pg.query_selector('[data-act="assign-nurse"]') and E("me.role") == 'staff' and (nav('review', I('summary')) or True) and not pg.query_selector('#dxField') and not pg.query_selector('[data-act="review-done"]'))
    check('Z1', '整個測試過程沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_six.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
