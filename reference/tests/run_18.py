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
    ctx.add_init_script('window.__SEED=' + json.dumps(seed, ensure_ascii=False) + '; try { const __sn = sessionStorage.getItem("__snap"); if (__sn) window.__SEED = JSON.parse(__sn); } catch (e) {};' + mock)
    ctx.route('**/fonts.g*/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errs.append(m.text))
    pg.goto('file:///home/claude/simp/' + (sys.argv[1] if len(sys.argv) > 1 else 'index.html')); pg.wait_for_selector('#portal, #loginForm')
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


    def tabs():
        return E("[...document.querySelectorAll('nav.subnav button')].map(b => [b.dataset.page, b.getAttribute('aria-current') === 'page', getComputedStyle(b).borderBottomColor, (b.querySelector('.badge') || {}).textContent || ''])")
    def one(page_):
        t = tabs(); sel = [x[0] for x in t if x[1]]; col = {x[0]: x[2] for x in t}
        blue = [x[0] for x in t if x[2] == col.get(page_)]
        return sel == [page_] and blue == [page_], t
    def click(page_):
        pg.click(f'nav.subnav button[data-page="{page_}"]'); W(500)
    # 用管理員「測試資料」建立 TEST-A～D（只在本機模擬資料庫），讓護理工作清單有待辦數量
    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed-missing"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(1000)
    login('nurse@example.com')
    n_badge = tabs()[0][3]
    check('T1', '護理（有分配權限）導覽列分頁', '顯示 工作清單、負責住民、案件分配 三個分頁；工作清單有紅色待辦數量徽章', [x[0] for x in tabs()] == ['home', 'residents', 'assign'] and n_badge.isdigit() and int(n_badge) > 0, tabs())
    for i, (p_, nm) in enumerate([('assign', '案件分配'), ('home', '工作清單'), ('residents', '負責住民'), ('assign', '案件分配'), ('residents', '負責住民'), ('home', '工作清單')]):
        click(p_); ok, t = one(p_)
        check(f'T2-{i+1}', f'點選「{nm}」', f'只有「{nm}」有 aria-current="page" 與藍色底線，其他分頁恢復未選取樣式；工作清單徽章仍是 {n_badge}', ok and route_ok(p_) and tabs()[0][3] == n_badge, t) if False else None
        rp = E("route.page")
        check(f'T2-{i+1}', f'點選「{nm}」', f'畫面進入該頁；只有「{nm}」有 aria-current="page" 與藍色底線，其他分頁恢復未選取樣式；工作清單徽章仍是 {n_badge}', ok and rp == p_ and tabs()[0][3] == n_badge, (rp, t))
    # 詳細頁與返回
    click('residents'); first = pg.query_selector('main [data-act="go"][data-page="resident"], main [data-page="resident"]')
    if first:
        first.click(); W(500); ok1, t1 = one('residents'); rp1 = E("route.page")
        bk = pg.query_selector('main [data-act="go"][data-page="residents"]')
        if bk: bk.click(); W(500)
        ok2, t2 = one('residents')
        check('T3', '負責住民 → 住民詳細頁 → 頁面上的返回', '詳細頁時只有「負責住民」選取；按頁面上的返回回到負責住民，仍只有一個選取', rp1 == 'resident' and ok1 and bk is not None and E("route.page") == 'residents' and ok2, (rp1, t1, t2))
    else: check('T3', '負責住民 → 住民詳細頁 → 返回', '找到住民詳細頁連結', False, 'no resident link')
    click('assign'); fc = pg.query_selector('main [data-act="go"]:not([data-page="assign"])')
    # 從案件分配開啟案件再回到工作清單
    E("go('review', null)") if False else None
    # 重新整理
    # 重新整理：測試用模擬資料庫在重新整理時會回到初始資料，所以先把目前的資料存到 sessionStorage，讓重新整理後沿用（登入狀態也在其中）
    click('assign'); E("sessionStorage.setItem('__snap', JSON.stringify(Object.fromEntries(window.__store)))"); pg.reload(); pg.wait_for_selector('nav.subnav', timeout=20000); W(800); E("sessionStorage.removeItem('__snap')"); rp = E("route.page"); ok, t = one(rp if rp in ('home','residents','assign') else 'home')
    check('T4', '在案件分配頁重新整理', f'重新整理後回到系統預設頁（{rp}），只有對應的一個分頁選取，徽章仍在', ok and len([x for x in t if x[1]]) == 1 and t[0][3].isdigit(), (rp, t))
    click('assign'); ok, t = one('assign')
    check('T5', '重新整理後再點案件分配', '只有「案件分配」選取', ok, t)
    # 沒有分配權限的護理師
    login('nurse2@example.com'); t = tabs()
    check('T6', '護理（沒有分配權限）', '只有 工作清單、負責住民；各點一次都只有一個選取', [x[0] for x in t] == ['home', 'residents'] and (click('residents') or one('residents')[0]) and (click('home') or one('home')[0]), t)
    # 其他角色
    login('staff@example.com')
    r = [(click(p_) or one(p_)[0]) for p_ in ('cases', 'home', 'cases')]
    nav('case', A); okc, tc = one('cases')
    check('T7', '行政（工作清單、案件）', '切換分頁每次只有一個選取；案件詳細頁只有「案件」選取', all(r) and okc, (r, tc))
    login('family@example.com'); r = [(click(p_) or one(p_)[0]) for p_ in ('notices', 'home', 'notices', 'home')]
    check('T8', '家屬（我的申請、通知）', '切換分頁每次只有一個選取', all(r), tabs())
    login('admin@example.com'); r = [(click(p_) or one(p_)[0]) for p_ in ('settings', 'archive', 'logs', 'testdata', 'accounts')]
    check('T9', '系統管理員（五個分頁）', '切換分頁每次只有一個選取', all(r), tabs())
    login('care@example.com') if E("!!D.accounts['care@example.com']") else None
    if E("me && me.role === 'care'"): check('T10', '照服員（我的住民）', '唯一分頁為選取', one('home')[0], tabs())
    login('nurse@example.com'); click('assign'); okA, tA = one('assign')
    check('T11', '切換角色後再回到護理', '登出其他角色、登入護理後點案件分配：只有「案件分配」選取，工作清單徽章仍在', okA and tA[0][3].isdigit(), tA)
    css = E("[...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).filter(r => (r.selectorText || '').includes('.subnav button')).map(r => r.cssText)")
    check('T12', '選取樣式只依 aria-current（靜態）', '.subnav 的藍色底線只由 [aria-current="page"] 決定，沒有額外的強制隱藏規則', any('aria-current' in c for c in css) and not any('!important' in c for c in css), css)
    check('E', '頁面錯誤', '沒有 JavaScript 錯誤', not errs, errs[:3])
    json.dump(results, open('/home/claude/simp/run_18' + ('_old' if len(sys.argv) > 1 else '') + '.json', 'w'), ensure_ascii=False)
    print('TOTAL', len(results), 'PASS', sum(1 for r in results if r['result'] == 'PASS'))
