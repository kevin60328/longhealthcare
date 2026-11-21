"""契約簽約判斷統一與文件名稱儲存分離。用法：python3 run_p.py [舊版 HTML 路徑]（只用來重現舊版問題）"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/simp/index.html'; OLD = len(sys.argv) > 1
A, B = 'C-0001-p4t8', 'C-0002-r6w3'; I = lambda k, c=A: f'{c}_{k}'
IMG = lambda n: open('/home/claude/simp/img/' + n + '.png', 'rb').read()
results, errs = [], []
def check(t, n, expect, ok, actual=''):
    s = 'PASS' if ok is True else 'FAIL'
    results.append({'id': t, 'case': n, 'expect': expect, 'result': s, 'actual': '' if ok is True else str(actual)[:300]}); print(s, t, n, '' if ok is True else str(actual)[:300]); sys.stdout.flush()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script('window.__SEED=' + json.dumps(seed, ensure_ascii=False) + ';' + mock); ctx.route('**/fonts.g*/**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errs.append(m.text))
    pg.goto('file://' + TARGET); pg.wait_for_selector('#portal, #loginForm')
    W = lambda ms=500: pg.wait_for_timeout(ms); E = lambda js: pg.evaluate(js)
    store = lambda path: E(f"(() => {{ const d = window.__store.get('{path}'); return d ? JSON.parse(JSON.stringify(d)) : null; }})()")
    st = lambda k, c=A: E(f"status(D.items['{I(k, c)}'], D.cases['{c}'])")
    ph = lambda c=A: E(f"phase(D.cases['{c}'])")
    main = lambda: pg.inner_text('main')
    CUR = [None]
    def assign(c, n):
        prev = CUR[0]; login('nurse@example.com'); pg.evaluate("go('assign')"); pg.wait_for_timeout(300); pg.click(f'[data-act="assign-nurse"][data-case="{c}"]'); pg.wait_for_timeout(200); pg.select_option('#asNurse', n); pg.click('[data-act="modal-ok"]'); pg.wait_for_timeout(1500); login(prev)
    def login(e):
        CUR[0] = e
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
    def upload(c, key, img, date=None):
        nav('upload', c, I(key, c)); pg.set_input_files('#file', {'name': img + '.png', 'mimeType': 'image/png', 'buffer': IMG(img)})
        if date and pg.query_selector('#examDate'): pg.fill('#examDate', date)
        pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    def receipt(c, key, birth, signer=None):
        nav('receipt', I(key, c))
        if pg.query_selector('#signerForm'):
            pg.fill('#signerForm [name=signerName]', signer); pg.check('#signerForm [name=signerOk]'); pg.check('#signerForm [name=content]'); pg.click('#signerForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300); return
        pg.select_option('#receiptForm [name=m-name]', '相符')
        if pg.query_selector('#receiptForm [name=m-nid]'): pg.select_option('#receiptForm [name=m-nid]', '相符')
        if pg.query_selector('#birthRaw'): pg.fill('#birthRaw', birth)
        W(150)
        if not pg.is_hidden('#manualBox'): pg.check('#manualBox input[name=how] >> nth=0')
        if pg.query_selector('#receiptForm [name=content]'): pg.check('#receiptForm [name=content]')
        pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def review(c, key, quick=None, fill=None):
        nav('review', I(key, c))
        for i, q in (quick or {}).items(): pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="{q}"]'); W(150)
        for i, v in (fill or {}).items(): pg.fill(f'#fv-{i}', v)
        for _ in range(80):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(50)
        pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def judge(c, key, val, note):
        nav('resident', c); pg.click(f'[data-act="need-edit"][data-item="{I(key, c)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
    def inst_up(c, key, img, note=''):
        nav('case', c); pg.click(f'[data-act="inst-up"][data-item="{I(key, c)}"]'); W(200); pg.set_input_files('#ipFile', {'name': img + '.png', 'mimeType': 'image/png', 'buffer': IMG(img)}); pg.fill('#ipNote', note); pg.click('[data-act="modal-ok"]'); W(1500)

    keysOf = lambda pre: E(f"[...window.__store.keys()].filter(k => k.startsWith('{pre}'))")
    snapItems = lambda: {k: store(k) for k in keysOf('items/')}
    S0 = snapItems()
    sign = lambda c: (nav('case', c), pg.click('main [data-act="signed"]'), W(300), pg.query_selector('[data-act="modal-ok"]') and pg.click('[data-act="modal-ok"]'), W(1200))
    def all_ok(c):
        for _ in range(80):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(50)
    def review_exam(c):
        nav('review', I('exam', c))
        for k in ['cbc', 'liver', 'kidney', 'glu', 'lyte', 'urine', 'infect', 'other']:
            i = E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}')"); pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="報告內有"]'); W(100)
            pg.fill('#fv-' + str(E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}_r')")), '文字判讀：正常')
        pg.click('[data-act="f-quick"][data-i="' + str(E("reviewState.fields.findIndex(f => f.k === 'examNote')")) + '"][data-q="文件未記載"]'); W(100)
        all_ok(c); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def make_card(c, cg):
        nav('card', c); blocked = pg.query_selector('#cardForm') is None
        if blocked: return False
        pg.check(f'#cardForm input[name=cg][value="{cg}"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800); return True
    def try_assess(c, result, move):
        nav('assess', c)
        if not pg.query_selector('#assessForm'): return '沒有評估表單：' + main()[:80]
        pg.select_option('#assessForm [name=move]', move); pg.check(f'#assessForm input[name=result][value="{result}"]'); pg.click('#assessForm button[type=submit]'); W(300)
        if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
        try: pg.wait_for_function("route.page === 'home'", timeout=8000); W(500); return True
        except Exception: return '送出失敗：' + (pg.inner_text('.err') if pg.query_selector('.err') else main()[:80])
    guard = lambda c: E(f"assessGuard(D.cases['{c}'])"); allowed = lambda c: E(f"cardAllowed(D.cases['{c}'])")
    nver = lambda k, c=A: len(store('items/' + I(k, c))['versions'])
    # ================= 一、先審後簽：契約未上傳 =================
    login('staff@example.com')
    for c, n in [(A, 'nurse@example.com'), (B, 'nurse2@example.com')]:
        nav('apply', c); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(c, n)
    login('family@example.com'); nav('consent', A); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    login('nurse@example.com'); judge(A, 'tubeCare', 'no', '入院前已移除'); judge(A, 'woundCare', 'no', '無傷口'); judge(A, 'swallow', 'no', '可由口進食')
    login('family@example.com')
    for k, img in [('idcopy', '01_身分證影本_張秀英'), ('nhi', '02_健保卡_張秀英'), ('summary', '03_出院病歷摘要_張秀英'), ('meds', '04_用藥清單_張秀英')]: upload(A, k, img)
    login('staff@example.com'); receipt(A, 'idcopy', '民國 29 年 6 月 12 日'); receipt(A, 'nhi', '029/06/12'); receipt(A, 'summary', '1940/06/12'); receipt(A, 'meds', '1940/06/12')
    login('nurse@example.com')
    review(A, 'summary', quick={0: '住院出院摘要', 5: '無'}, fill={1: '腦中風後遺症', 2: '2026-11-04', 3: '鼻胃管', 4: '磺胺類藥物（皮疹）'})
    review(A, 'meds', quick={1: '文件未記載'}, fill={0: 'Aspirin 100 mg 每日一次'})
    r = try_assess(A, '收治', '一人協助')
    check('A1', '先審後簽：收治評估', '評估前文件完成後可以評估；案件「已收治待簽約」、契約「待簽約」', r is True and ph() == '已收治待簽約' and st('contract') == '待簽約', (r, ph()))
    login('staff@example.com'); sign(A)
    check('A2', '先審後簽：行政登錄簽約、沒有上傳契約', '有簽約日期；契約「已登錄簽約」且沒有任何檔案版本；案件進入「入住前文件審查／待補件」', bool(store('cases/' + A).get('signedAt')) and st('contract') == '已登錄簽約' and nver('contract') == 0 and ph() in ('待補件', '入住前文件審查'), (st('contract'), ph()))
    login('family@example.com'); upload(A, 'exam', '08_體檢報告_張秀英', '2026-11-05')
    nav('upload', A, I('xray')); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    upload(A, 'stool', '09_糞便檢查_張秀英', '2026-11-05'); upload(A, 'signerId', '10_簽約者身分證_張家豪'); upload(A, 'emergency', '12_緊急事故處理同意書_張秀英')
    login('staff@example.com'); nav('case', A); pg.click(f'[data-act="need-edit"][data-item="{I("relProof")}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    for k in ['exam', 'xray', 'stool']: receipt(A, k, '1940/06/12')
    receipt(A, 'signerId', None, signer='張家豪'); receipt(A, 'emergency', None)
    for k in ['exam', 'xray', 'stool']:
        nav('date', I(k)); pg.fill('#dateVal', '2026-11-05'); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse@example.com'); review_exam(A); review(A, 'xray', fill={0: '心肺無明顯異常'}); review(A, 'stool', fill={0: '陰性'})
    check('A3', '先審後簽：其他入住前文件完成', '契約沒有檔案，案件仍進入「摘要卡審核中」，可以產生摘要卡', ph() == '摘要卡審核中' and allowed(A) is True and nver('contract') == 0, (ph(), allowed(A)))
    ok = make_card(A, 'care@example.com')
    check('A4', '先審後簽：照護摘要卡產生並開放', '摘要卡狀態「已開放」，案件「摘要卡已開放」', ok and store('cases/' + A)['card']['status'] == '已開放' and ph() == '摘要卡已開放', (ok, ph()))
    login('care@example.com'); nav('card', A); t = main()
    check('A5', '先審後簽：照服員可以看到摘要卡', '摘要卡有診斷與管路', '腦中風後遺症' in t and '鼻胃管' in t)
    login('family@example.com'); upload(A, 'contract', '13_入住契約_張秀英')
    check('A6', '先審後簽：開放後家屬補傳契約影本', '契約影本第 1 版「待收件」並保留；摘要卡仍開放，不會被退回或停用', st('contract') == '待收件' and nver('contract') == 1 and ph() == '摘要卡已開放', (st('contract'), ph()))
    # ================= 二、先簽後審：契約未上傳 =================
    login('family2@example.com'); nav('consent', B); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    for k, img, d in [('idcopy', '14_身分證影本_陳金水', None), ('nhi', '15_健保卡_陳金水', None), ('summary', '16_近期醫療摘要_陳金水', None), ('meds', '17_用藥清單_陳金水', None), ('exam', '18_體檢報告_陳金水', '2026-11-06'), ('stool', '19_糞便檢查_陳金水', '2026-11-07'), ('signerId', '20_簽約者身分證_陳淑芬', None), ('emergency', '21_緊急事故處理同意書_陳金水', None)]:
        upload(B, k, img, d)
    nav('upload', B, I('xray', B)); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    S1 = snapItems()
    login('nurse2@example.com'); judge(B, 'tubeCare', 'no', '無'); judge(B, 'woundCare', 'no', '無'); judge(B, 'swallow', 'no', '無')
    login('staff@example.com'); nav('case', B); pg.click(f'[data-act="need-edit"][data-item="{I("relProof", B)}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    for k in ['idcopy', 'nhi', 'summary', 'meds', 'exam', 'xray', 'stool']: receipt(B, k, '1936/09/20')
    receipt(B, 'signerId', None, signer='陳淑芬'); receipt(B, 'emergency', None)
    for k, d in [('exam', '2026-11-06'), ('xray', '2026-11-06'), ('stool', '2026-11-07')]:
        nav('date', I(k, B)); pg.fill('#dateVal', d); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse2@example.com')
    review(B, 'summary', quick={0: '門診／近期醫療摘要', 5: '文件未記載'}, fill={1: '失智症、糖尿病', 3: '無', 4: '無已知過敏'})
    review(B, 'meds', quick={1: '文件未記載'}, fill={0: 'Metformin 500 mg 每日兩次'}); review_exam(B); review(B, 'xray', fill={0: '心肺無明顯異常'}); review(B, 'stool', fill={0: '陰性'})
    g0 = guard(B)
    check('B1', '先簽後審：文件完成、尚未簽約', '案件「待簽約」；護理不能做入住前確認（理由是尚未記錄契約）', ph(B) == '待簽約' and '契約' in str(g0), (ph(B), g0))
    login('staff@example.com'); sign(B)
    check('B2', '先簽後審：行政登錄簽約、沒有上傳契約', '契約「已登錄簽約」、沒有檔案版本；案件「入住前確認中」', st('contract', B) == '已登錄簽約' and nver('contract', B) == 0 and ph(B) == '入住前確認中', (st('contract', B), ph(B)))
    login('family2@example.com'); upload(B, 'contract', '13_入住契約_張秀英')
    login('nurse2@example.com'); g1 = guard(B)
    check('B3', '先簽後審：簽約後家屬上傳的契約影本還在確認中', '契約影本「待收件」時，護理入住前確認的前置條件仍然通過（舊版在這裡會擋住）', st('contract', B) == '待收件' and g1 is True, (st('contract', B), g1))
    r = try_assess(B, '可入住', '可自行移位')
    check('B4', '先簽後審：護理入住前確認', '實際送出「可入住」成功；案件「摘要卡審核中」', r is True and ph(B) == '摘要卡審核中', (r, ph(B)))
    ok = make_card(B, 'care2@example.com')
    check('B5', '先簽後審：照護摘要卡開放', '摘要卡「已開放」，契約影本仍在確認中且保留第 1 版', ok and store('cases/' + B)['card']['status'] == '已開放' and ph(B) == '摘要卡已開放' and nver('contract', B) == 1, (ok, ph(B)))
    login('staff@example.com'); receipt(B, 'contract', None)
    check('B6', '先簽後審：行政事後確認契約影本', '契約「確認符合」，案件維持「摘要卡已開放」', st('contract', B) == '確認符合' and ph(B) == '摘要卡已開放', (st('contract', B), ph(B)))
    if OLD:
        b.close(); print('OLD MODE RESULTS'); print(json.dumps([r for r in results if r['result'] == 'FAIL'], ensure_ascii=False, indent=1)); sys.exit()
    # ================= 三、只有契約影本、沒有正式簽約紀錄 =================
    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed-missing"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(1000)
    TB, TC = 'TEST-B', 'TEST-C'
    login('nurse@example.com'); r = try_assess(TB, '收治', '一人協助')
    login('family3@example.com'); upload(TB, 'contract', '13_入住契約_張秀英')
    login('staff@example.com'); receipt(TB, 'contract', None)
    check('C1', '只有契約影本（行政也確認收件）、沒有簽約紀錄', '契約「待登錄簽約」；沒有簽約日期；案件仍是「已收治待簽約」；不能產生摘要卡', r is True and st('contract', TB) == '待登錄簽約' and not store('cases/' + TB).get('signedAt') and ph(TB) == '已收治待簽約' and allowed(TB) is False, (r, st('contract', TB), ph(TB)))
    login('nurse@example.com'); nav('card', TB)
    check('C2', '只有契約影本時，護理開啟摘要卡頁', '沒有可送出的摘要卡表單', pg.query_selector('#cardForm') is None)
    sim = E(f"""(() => {{ const c = JSON.parse(JSON.stringify(D.cases['{B}'])); delete c.signedAt; delete c.assessment; delete c.card; c.id = '{B}'; const save = D.cases['{B}']; D.cases['{B}'] = c; me = D.accounts['nurse2@example.com']; const out = [phase(c), assessGuard(c), cardAllowed(c), status(D.items['{I('contract', B)}'], c)]; D.cases['{B}'] = save; me = D.accounts['nurse@example.com']; return out; }})()""")
    check('C3', '先簽後審：契約影本已確認但沒有簽約紀錄（程式邏輯檢查）', '把陳金水的簽約日期拿掉後：案件「待簽約」、不能入住前確認、不能產生摘要卡、契約「待登錄簽約」', sim[0] == '待簽約' and '契約' in str(sim[1]) and sim[2] is False and sim[3] == '待登錄簽約', sim)
    # TEST-C：已簽約、契約簽名頁已確認（原有測試資料），摘要卡照常
    login('nurse@example.com'); ok = make_card(TC, 'care@example.com')
    check('C4', '測試案件 C（已簽約、契約檔案已確認）', '原有測試案件可以照常審核並開放摘要卡', st('contract', TC) == '確認符合' and ok and ph(TC) == '摘要卡已開放', (st('contract', TC), ok, ph(TC)))
    # ================= 四、名稱儲存 =================
    S2 = snapItems()
    changed = [k for k in S0 if k in S2 and S2[k]['name'] != S0[k]['name']]
    check('N1', '家屬、行政、護理交替操作後，原有文件名稱沒有被改寫', f'{len(S0)} 份原有文件的資料庫名稱都和操作前相同（舊名稱，例如「機構指定的體檢報告」）', not changed and S2['items/' + I('exam')]['name'] == S0['items/' + I('exam')]['name'], changed[:5])
    fam_names = set(E("Object.entries(FAMILY_NAME).filter(([k, v]) => v !== STAFF_NAME[k]).map(([k, v]) => v)"))
    bad = [k for k, v in S2.items() if v['name'] in fam_names and S0.get(k, {}).get('name') != v['name']]
    check('N2', '資料庫裡沒有出現家屬版名稱', '任何文件的 name 都不是因操作而變成家屬版名稱', not bad, bad[:5])
    keep = []
    for k, v in S1.items():
        w = S2[k]
        for f in ['versions', 'needHist']:
            a, bb = v.get(f) or [], w.get(f) or []
            if f == 'versions': a = [{x: y for x, y in z.items() if x in ('v', 'at', 'by', 'file', 'fromItem', 'userDate')} for z in a]; bb = [{x: y for x, y in z.items() if x in ('v', 'at', 'by', 'file', 'fromItem', 'userDate')} for z in bb[:len(a)]]
            if bb[:len(a)] != a: keep.append((k, f))
        if v['key'] != w['key'] or v['caseId'] != w['caseId']: keep.append((k, 'key'))
    check('N3', '文件 ID、版本、來源與判斷歷程保留', '中途快照後的所有文件：key、案件、每個版本的上傳資料與需求判斷歷程都原樣保留（只會往後新增）', not keep, keep[:5])
    fx = S2['items/' + I('xray')]['versions'][0]['fromItem']
    check('N4', '沿用檔案的來源名稱存資料庫名稱', '胸部 X 光沿用體檢報告時，來源記錄的是資料庫原本的名稱，不是角色顯示名稱', fx['name'] == S0['items/' + I('exam')]['name'], fx)
    rv = S2['items/' + I('summary')]['versions'][0]
    check('N5', '核對與審核紀錄保留', '出院摘要的核對欄位、護理確認與行政身分核對都在', bool(rv.get('review') and rv.get('nurseOk') and rv.get('idCheck')), list(rv)[:12])
    # 本機模擬資料庫在重新整理頁面時會回到初始資料，所以改成「從資料庫重新讀取所有文件」來模擬重新載入
    E("D.items = itemsMap(Object.fromEntries([...window.__store.keys()].filter(k => k.startsWith('items/')).map(k => [k.slice(6), Object.assign({id:k.slice(6)}, JSON.parse(JSON.stringify(window.__store.get(k))))])))")
    login('family@example.com'); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)"); t = (to_guide() or pg.text_content('#docList'))
    f_ok = '管路照護資料' in t and '住民身分證明文件' in t and '管路留置與照護紀錄' not in t
    login('staff@example.com'); nav('case', A); t2 = pg.text_content('main')
    s_ok = '管路留置與照護紀錄' in t2 and '住民身分證明文件' in t2 and '入住前健康檢查報告' in t2
    src_disp = E(f"srcName(D.items['{I('xray')}'].versions[0].fromItem)")
    check('N6', '從資料庫重新讀取後各角色名稱正確', '家屬看到家屬版名稱、行政看到正式名稱；沿用來源顯示目前的正式名稱', f_ok and s_ok and src_disp == '入住前健康檢查報告', (f_ok, s_ok, src_disp, '沿用「入住前健康檢查報告」' in t2))
    S3 = snapItems()
    check('N7', '重新讀取並切換帳號後再比對', '資料庫文件名稱仍與操作前相同', all(S3[k]['name'] == S0[k]['name'] for k in S0))
    old_written = E("(() => { const k = Object.keys(D.items)[0]; const it = D.items[k]; const raw = rawItem(it); return [it.name, raw.name, it._dbName]; })()")
    check('N8', '寫入前一律換回資料庫名稱（程式檢查）', '畫面物件顯示正式名稱，但寫入資料庫的內容使用資料庫原名稱', old_written[1] == old_written[2], old_written)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_p.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
