"""文件專業名稱與契約、費用文件提供者調整。"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
HTML = open('/home/claude/simp/index.html', encoding='utf-8').read()
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
    pg.goto('file:///home/claude/simp/index.html'); pg.wait_for_selector('#portal, #loginForm')
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
    before_names = {k: store(k)['name'] for k in E("[...window.__store.keys()].filter(k => k.startsWith('items/'))")}
    # ===== 名稱 =====
    login('staff@example.com'); nav('apply', A); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(A, 'nurse@example.com')
    nav('apply', B); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(B, 'nurse2@example.com')
    nav('case', A); t = main()
    staff_names = ['住民身分證明文件', '戶籍資料或代理權限證明', '入住前健康檢查報告', '糞便檢驗報告', '其他指定檢查報告', '出院病歷摘要／近期就醫摘要', '診斷證明書', '回診預約資料／後續追蹤醫囑', '管路留置與照護紀錄', '傷口評估與照護紀錄', '吞嚥功能評估與飲食建議', '住宿式長照服務契約', '服務收費明細', '保證金繳納紀錄／收據']
    check('N1', '行政案件頁使用正式名稱', '14 個改名的文件都以正式名稱顯示；分類為「B. 入住前健康檢查資料」「D. 特殊照護資料」', all(x in t for x in staff_names) and '入住前健康檢查資料' in t and '特殊照護資料' in t, [x for x in staff_names if x not in t])
    login('family@example.com'); nav('consent', A); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)"); t = (to_guide() or pg.text_content('#docList'))
    fam = ['住民身分證明文件', '管路照護資料', '傷口照護資料', '復健及行動能力資料', '吞嚥與飲食資料', '排泄與睡眠照護資料', '緊急聯絡人資料', '個人資料蒐集、處理及利用同意書（線上簽署）', '住宿式長照服務契約', '服務收費明細']
    check('N2', '家屬端使用好懂的名稱', '住民身分證明文件（第 (15) 版全角色統一用「住民」）、D 類家屬名稱、緊急聯絡人資料、個資同意書；不顯示「管路留置與照護紀錄」', all(x in t for x in fam) and '管路留置與照護紀錄' not in t, [x for x in fam if x not in t])
    after_names = {k: store(k)['name'] for k in before_names}
    check('N3', '資料庫的文件名稱與內部 key 沒有被改寫（靜態＋資料檢查）', '原有文件項目的 name、key 與 ID 都和改版前相同；畫面名稱由 key 對應', after_names == before_names and all(store(k)['key'] == k.split('_', 1)[1] for k in list(before_names)[:24]) and "const STAFF_NAME" in HTML, None)
    # ===== F 類 =====
    rows = E("Object.fromEntries([...document.querySelectorAll('#docList .drow')].map(r => [r.querySelector('.t-name').textContent, r.textContent]))")
    btns = E("[...document.querySelectorAll('#docList .drow')].filter(r => r.querySelector('button[data-page=upload]')).map(r => r.querySelector('.t-name').textContent)")
    check('F1', '家屬端的契約與費用文件', '服務收費明細、繳費收據、保證金顯示「機構提供」，狀態「機構尚未提供」，沒有上傳按鈕；契約顯示「機構提供，簽約時完成」', all('機構提供' in rows[n] and '機構尚未提供' in rows[n] and n not in btns for n in ['服務收費明細', '繳費收據', '保證金繳納紀錄／收據']) and '機構提供，簽約時完成' in rows['住宿式長照服務契約'] and '簽約時完成' in rows['住宿式長照服務契約'], {k: rows[k][:60] for k in ['服務收費明細', '住宿式長照服務契約']})
    nav('upload', A, I('fee'))
    check('F2', '家屬無法進入收費明細的上傳頁', '直接開啟會回到首頁', pg.query_selector('#uploadForm') is None)
    # 準備：評估前文件
    login('nurse@example.com'); judge(A, 'tubeCare', 'no', '無管路'); judge(A, 'woundCare', 'no', '無傷口'); judge(A, 'swallow', 'no', '可由口進食')
    login('family@example.com'); upload(A, 'idcopy', '01_身分證影本_張秀英'); upload(A, 'nhi', '02_健保卡_張秀英'); upload(A, 'summary', '03_出院病歷摘要_張秀英'); upload(A, 'meds', '04_用藥清單_張秀英')
    login('staff@example.com'); nav('receipt', I('summary')); t = main()
    check('N4', '行政收件核對頁使用正式名稱', '標題顯示「出院病歷摘要／近期就醫摘要」', '出院病歷摘要／近期就醫摘要' in t)
    receipt(A, 'idcopy', '民國 29 年 6 月 12 日'); receipt(A, 'nhi', '029/06/12'); receipt(A, 'summary', '1940/06/12'); receipt(A, 'meds', '1940/06/12')
    login('nurse@example.com'); nav('review', I('summary')); t = main()
    check('N5', '護理核對頁使用正式名稱，核對欄位不變', '標題為正式名稱；欄位仍是摘要類型、主要診斷、出院日期、管路、藥物過敏、傷口', '出院病歷摘要／近期就醫摘要' in t and E("reviewState.fields.map(f => f.k).join()") == 'stype,dx,dc,tube,allergy,wound')
    review(A, 'summary', quick={0: '住院出院摘要', 5: '無'}, fill={1: '腦中風後遺症', 2: '2026-11-04', 3: '鼻胃管', 4: '磺胺類藥物（皮疹）'})
    review(A, 'meds', quick={1: '文件未記載'}, fill={0: 'Aspirin 100 mg 每日一次'})
    nav('resident', A); t = main()
    check('N6', '護理負責住民頁與需求判斷', '照護文件需求確認列出管路留置與照護紀錄、傷口評估與照護紀錄、吞嚥功能評估與飲食建議', all(x in pg.inner_text('#needCard') for x in ['管路留置與照護紀錄', '傷口評估與照護紀錄', '吞嚥功能評估與飲食建議']))
    nav('assess', A); pg.select_option('#assessForm [name=move]', '一人協助'); pg.check('#assessForm input[name=result][value="收治"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(500)
    # 契約：行政先上傳契約，不等於簽約
    login('staff@example.com')
    check('F3', '先審後簽：簽約前的契約狀態', '契約「待簽約」；案件「已收治待簽約」', st('contract') == '待簽約' and ph() == '已收治待簽約', (st('contract'), ph()))
    inst_up(A, 'contract', '13_入住契約_張秀英', '雙方簽署版本')
    check('F4', '行政上傳契約檔案不代表完成簽約', '契約「待登錄簽約」、沒有簽約日期、案件仍是「已收治待簽約」', st('contract') == '待登錄簽約' and not store('cases/' + A).get('signedAt') and ph() == '已收治待簽約', (st('contract'), ph()))
    nav('case', A); pg.click('main [data-act="signed"]'); W(300)
    if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
    W(1200)
    check('F5', '記錄簽約後契約狀態一致', '有簽約日期；契約變成「確認符合」（已上傳的簽署版）', bool(store('cases/' + A).get('signedAt')) and st('contract') == '確認符合', st('contract'))
    inst_up(A, 'fee', '13_入住契約_張秀英', '月費明細')
    check('F6', '行政上傳服務收費明細', '收費明細「確認符合」，標示機構提供；繳費收據、保證金未提供仍不算缺件', st('fee') == '確認符合' and store('items/' + I('fee'))['versions'][0]['provider'] == '機構' and st('payReceipt') == '機構尚未提供' and not E(f"activeItems(D.cases['{A}']).some(i => ['payReceipt','deposit'].includes(i.key))"), st('fee'))
    login('family@example.com'); todo = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.key)")
    t = (to_guide() or pg.text_content('#docList'))
    check('F7', '家屬不會因契約與費用被列為缺件', '待辦只有家屬要交的入住前文件（體檢、X 光、糞便、簽約者證明等），沒有契約、收費明細、收據、保證金', not set(todo) & {'contract', 'fee', 'payReceipt', 'deposit'} and 'exam' in todo, todo)
    upload(A, 'exam', '08_體檢報告_張秀英', '2026-11-05')
    nav('upload', A, I('xray')); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    upload(A, 'stool', '09_糞便檢查_張秀英', '2026-11-05'); upload(A, 'signerId', '10_簽約者身分證_張家豪'); upload(A, 'emergency', '12_緊急事故處理同意書_張秀英')
    login('staff@example.com'); need_rel = E(f"needOf(D.items['{I('relProof')}'])")
    nav('case', A); pg.click(f'[data-act="need-edit"][data-item="{I("relProof")}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    for k in ['exam', 'xray', 'stool']: receipt(A, k, '1940/06/12')
    receipt(A, 'signerId', None, signer='張家豪'); receipt(A, 'emergency', None)
    for k in ['exam', 'xray', 'stool']:
        nav('date', I(k)); pg.fill('#dateVal', '2026-11-05'); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse@example.com')
    nav('review', I('exam'))
    for k in ['cbc', 'liver', 'kidney', 'glu', 'lyte', 'urine', 'infect', 'other']:
        i = E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}')"); pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="報告內有"]'); W(100)
        pg.fill('#fv-' + str(E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}_r')")), '文字判讀：正常')
    pg.click('[data-act="f-quick"][data-i="' + str(E("reviewState.fields.findIndex(f => f.k === 'examNote')")) + '"][data-q="文件未記載"]'); W(100)
    for _ in range(80):
        if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
        pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(50)
    pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    review(A, 'xray', fill={0: '心肺無明顯異常'}); review(A, 'stool', fill={0: '陰性'})
    check('F8', '先審後簽完整流程', '收據、保證金未提供，案件仍進入「摘要卡審核中」', ph() == '摘要卡審核中', ph())
    nav('card', A); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(500)
    login('care@example.com'); nav('card', A); t = main()
    check('F9', '照服員查看摘要卡不受影響', '摘要卡有已確認的診斷與管路資料', '腦中風後遺症' in t and '鼻胃管' in t)
    login('family@example.com'); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)")
    r = E("(() => { const r = [...document.querySelectorAll('#docList .drow')].find(r => r.querySelector('.t-name').textContent === '住宿式長照服務契約'); return [r.textContent.replace(/\\s+/g, ' '), !!r.querySelector('button[data-page=upload]')]; })()")
    check('F10', '機構已登錄簽署版契約後，家屬端不需再上傳', '家屬看到「已完成」，沒有上傳按鈕', '已完成' in r[0] and not r[1], r)
    # ===== 先簽後審：家屬沒有上傳契約也能進入簽約 =====
    login('family2@example.com'); nav('consent', B); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    for k, img, d in [('idcopy', '14_身分證影本_陳金水', None), ('nhi', '15_健保卡_陳金水', None), ('summary', '16_近期醫療摘要_陳金水', None), ('meds', '17_用藥清單_陳金水', None), ('exam', '18_體檢報告_陳金水', '2026-11-06'), ('stool', '19_糞便檢查_陳金水', '2026-11-07'), ('signerId', '20_簽約者身分證_陳淑芬', None), ('emergency', '21_緊急事故處理同意書_陳金水', None)]:
        upload(B, k, img, d)
    nav('upload', B, I('xray', B)); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    login('nurse2@example.com'); judge(B, 'tubeCare', 'no', '無'); judge(B, 'woundCare', 'no', '無'); judge(B, 'swallow', 'no', '無')
    login('staff@example.com'); nav('case', B); pg.click(f'[data-act="need-edit"][data-item="{I("relProof", B)}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    for k in ['idcopy', 'nhi', 'summary', 'meds', 'exam', 'xray', 'stool']: receipt(B, k, '1936/09/20')
    receipt(B, 'signerId', None, signer='陳淑芬'); receipt(B, 'emergency', None)
    for k, d in [('exam', '2026-11-06'), ('xray', '2026-11-06'), ('stool', '2026-11-07')]:
        nav('date', I(k, B)); pg.fill('#dateVal', d); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse2@example.com')
    review(B, 'summary', quick={0: '門診／近期醫療摘要', 5: '文件未記載'}, fill={1: '失智症、糖尿病', 3: '無', 4: '無已知過敏'})
    review(B, 'meds', quick={1: '文件未記載'}, fill={0: 'Metformin 500 mg 每日兩次'})
    nav('review', I('exam', B))
    for k in ['cbc', 'liver', 'kidney', 'glu', 'lyte', 'urine', 'infect', 'other']:
        i = E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}')"); pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="報告內有"]'); W(100)
        pg.fill('#fv-' + str(E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}_r')")), '文字判讀：正常')
    pg.click('[data-act="f-quick"][data-i="' + str(E("reviewState.fields.findIndex(f => f.k === 'examNote')")) + '"][data-q="文件未記載"]'); W(100)
    for _ in range(80):
        if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
        pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(50)
    pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    review(B, 'xray', fill={0: '心肺無明顯異常'}); review(B, 'stool', fill={0: '陰性'})
    check('F11', '先簽後審：家屬沒有上傳契約', '其他文件都完成後案件進入「待簽約」，不會因契約檔案阻擋；契約顯示「待簽約」', ph(B) == '待簽約' and st('contract', B) == '待簽約', (ph(B), st('contract', B)))
    login('staff@example.com'); nav('case', B); pg.click('main [data-act="signed"]'); W(300)
    if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
    W(1200)
    check('F12', '先簽後審：記錄簽約', '契約「已登錄簽約」（沒有檔案也算完成）；案件「入住前確認中」', st('contract', B) == '已登錄簽約' and ph(B) == '入住前確認中', (st('contract', B), ph(B)))
    login('family2@example.com'); upload(B, 'contract', '13_入住契約_張秀英')
    check('F13', '先簽後審：簽約後家屬補充上傳契約影本', '契約變成「待收件」，案件仍是「入住前確認中」，不阻擋流程', st('contract', B) == '待收件' and ph(B) == '入住前確認中', (st('contract', B), ph(B)))
    # 通知用家屬名稱
    login('nurse2@example.com'); judge(B, 'tubeCare', 'yes', '入住前訪視發現鼻胃管')
    login('staff@example.com'); nav('case', B); pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("tubeCare", B)}"]'); pg.fill('#srNote', '請提供管路資料'); pg.click('[data-act="modal-ok"]'); W(1500)
    ns = [store(k)['text'] for k in E("[...window.__store.keys()].filter(k => k.startsWith('notices/'))") if store(k)['caseId'] == B]
    check('N7', '給家屬的補件通知使用家屬端名稱', '通知寫「管路照護資料」，不是「管路留置與照護紀錄」；補件追蹤（行政）顯示正式名稱', any('管路照護資料' in x for x in ns) and not any('管路留置' in x for x in ns) and '管路留置與照護紀錄' in (nav('followup') or main()), ns[-1:])
    login('admin@example.com'); nav('logs'); t = main()
    check('N8', '操作紀錄保留當時的文字', '新的紀錄使用新名稱；改版前建立的紀錄沒有被改寫', '建立入住文件清單' in t and store('logs/seed1')['what'] == '張家豪 提出 張秀英 的入住申請')
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_m.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
