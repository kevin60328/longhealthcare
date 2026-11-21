"""真實文件相容性：行政逐項比對、出院摘要類型、DNR 另行確認、體檢包含與結果分開、照護紀錄沿用與護理補充評估、資料層次與 FHIR 準備。"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
HTML = open('/home/claude/simp/index.html', encoding='utf-8').read()
A = 'C-0001-p4t8'; I = lambda k: f'{A}_{k}'
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
    st = lambda k: E(f"status(D.items['{I(k)}'], D.cases['{A}'])")
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
    def need(key, val, note):
        nav('case', A); pg.click(f'[data-act="need-edit"][data-item="{I(key)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
    def upload(key, img):
        nav('upload', A, I(key)); pg.set_input_files('#file', {'name': img + '.png', 'mimeType': 'image/png', 'buffer': IMG(img)}); pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    def confirm_all():
        for _ in range(80):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(60)
    rc_err = lambda: pg.inner_text('#rcErr')

    # 靜態檢查
    check('X1', 'DNR 不再是出院摘要的核對欄位（靜態檢查）', 'FIELD_DEFS.summary 沒有 dnr；有「摘要類型」與條件式出院日期', "{k:'dnr'" not in HTML and "{k:'stype',label:'摘要類型'" in HTML and "when:{k:'stype',in:['住院出院摘要']}" in HTML)
    check('X2', 'AI 辨識指示（靜態檢查）', '提示包含「不要推測或補充，也不要自行判定正常」、選項欄位只能填選項、檢查結果格式', '也不要自行判定正常' in HTML and '只能填：' in HTML and '項目｜數值｜單位｜參考區間｜異常' in HTML)
    # 準備案件
    login('staff@example.com'); nav('apply', A); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(A, 'nurse@example.com')
    login('family@example.com'); nav('consent', A); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    login('nurse@example.com'); nav('resident', A)
    for k, v, n in [('tubeCare', 'yes', '出院摘要記載鼻胃管'), ('woundCare', 'yes', '家屬告知有壓傷'), ('swallow', 'no', '管灌')]:
        pg.click(f'[data-act="need-edit"][data-item="{I(k)}"]'); W(200); pg.check(f'input[name=needSel][value="{v}"]'); pg.fill('#needNote', n); pg.click('[data-act="modal-ok"]'); W(900)
    login('family@example.com'); upload('idcopy', '01_身分證影本_張秀英'); upload('summary', '03_出院病歷摘要_張秀英'); upload('meds', '04_用藥清單_張秀英')
    nav('upload', A, I('tubeCare')); t = main(); btns = E("[...document.querySelectorAll('[data-act=use-doc]')].map(b => b.textContent)")
    check('C1', '照護紀錄可沿用其他已上傳文件', '管路照護資料的上傳頁提供「使用『出院病歷摘要或近期醫療摘要』」等按鈕', any('出院病歷摘要' in x for x in btns), btns)
    pg.click(f'[data-act="use-doc"][data-from="{I("summary")}"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    v = store('items/' + I('tubeCare'))['versions'][0]
    check('C2', '沿用同一份來源文件', '管路照護資料第 1 版沿用出院摘要的檔案，仍是「待收件」，要另外核對', v.get('fromItem', {}).get('id') == I('summary') and v['file']['fileDoc'] == store('items/' + I('summary'))['versions'][0]['file']['fileDoc'] and st('tubeCare') == '待收件', v.get('fromItem'))
    # ===== 行政逐項比對 =====
    login('staff@example.com')
    nav('receipt', I('idcopy')); rows = E("[...document.querySelectorAll('#receiptForm tbody th')].map(t => t.textContent.replace(/選填/, '').trim())")
    check('R1', '身分證件顯示的識別欄位', '姓名、身分證字號、出生日期；沒有病歷號與來源機構', rows == ['姓名', '身分證字號', '出生日期'], rows)
    nav('receipt', I('summary')); rows = E("[...document.querySelectorAll('#receiptForm tbody th')].map(t => t.textContent.replace(/選填/, '').trim())")
    check('R2', '醫院文件顯示的識別欄位', '姓名、身分證字號、病歷號（選填）、來源機構（選填）、出生日期', rows == ['姓名', '身分證字號', '病歷號', '來源機構', '出生日期'], rows)
    pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '沒有'); pg.check('#birthNone'); W(150)
    pg.click('#receiptForm button[type=submit]'); W(400); e1 = rc_err()
    check('R3', '缺少身分證字號與出生日期時不能直接確認', '提示「資料不足不能直接確認符合」，請選人工核實方式；文件仍待收件', '資料不足不能直接確認符合' in e1 and st('summary') == '待收件', e1)
    pg.check('#manualBox input[name=how][value="已比對病歷號與來源機構"]'); pg.click('#receiptForm button[type=submit]'); W(400); e2 = rc_err()
    check('R4', '選「比對病歷號與來源機構」但沒有填病歷號', '擋下並說明需要病歷號與來源機構相符', '病歷號' in e2 and st('summary') == '待收件', e2)
    pg.fill('#receiptForm [name=docChart]', 'RX-123456'); pg.select_option('#receiptForm [name=m-chart]', '記錄'); pg.fill('#receiptForm [name=docSrc]', '仁心醫院'); pg.select_option('#receiptForm [name=m-source]', '相符')
    pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    ic = store('items/' + I('summary'))['versions'][0]['idCheck']
    check('R5', '用病歷號與來源機構人工核實', '核對完成；紀錄為「人工核實」，保存文件上的病歷號、來源機構與出生日期「資料不足」', ic['level'] == '人工核實' and ic['rows']['chart']['doc'] == 'RX-123456' and ic['rows']['source']['result'] == '相符' and ic['birth']['result'] == '資料不足' and '已比對病歷號與來源機構' in ic['how'], ic)
    nav('receipt', I('meds')); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '相符'); pg.fill('#birthRaw', '1940/06/12'); W(150)
    check('R6', '證號與出生日期都相符時', '不需要人工核實（人工核實區塊隱藏）', pg.is_hidden('#manualBox'))
    pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    check('R7', '一般相符的醫療文件', '紀錄為「相符」、必要欄位全部相符', store('items/' + I('meds'))['versions'][0]['idCheck']['level'] == '相符')
    nav('receipt', I('idcopy')); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '相符'); pg.fill('#birthRaw', '民國 29 年 6 月 12 日'); pg.check('#receiptForm [name=content]'); pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    nav('receipt', I('tubeCare')); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '沒有'); pg.check('#birthNone'); pg.check('#manualBox input[name=how][value="其他"]'); pg.click('#receiptForm button[type=submit]'); W(300)
    check('R8', '選「其他」但沒有說明', '擋下', '說明' in rc_err())
    pg.fill('#receiptForm [name=howNote]', '與已核實的出院摘要為同一份檔案'); pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    # ===== 護理核對：摘要類型、條件欄位、文件未記載 =====
    login('nurse@example.com'); nav('review', I('summary'))
    labels = E("reviewState.fields.map(f => f.label)")
    check('N1', '出院摘要核對欄位', '摘要類型、主要診斷、出院日期（住院才需要）、管路、藥物過敏、傷口；沒有 DNR', labels == ['摘要類型', '主要診斷', '出院日期（住院出院摘要才需要）', '管路', '藥物過敏', '傷口'], labels)
    pg.fill('#fv-0', '出院摘要'); pg.click('[data-act="f-ok"][data-i="0"]'); W(300)
    check('N2', '摘要類型只能從選項選', '自由輸入「出院摘要」被擋下', '請從按鈕中選擇' in pg.inner_text('#fe-0'), pg.inner_text('#fe-0'))
    pg.click('[data-act="f-quick"][data-i="0"][data-q="門診／近期醫療摘要"]'); W(400)
    check('N3', '門診／近期醫療摘要不需要出院日期', '出院日期欄顯示「不適用」、沒有輸入框', pg.query_selector('#fv-2') is None and '不需要填寫' in main())
    pg.click('[data-act="f-undo"][data-i="0"]'); W(300); pg.click('[data-act="f-quick"][data-i="0"][data-q="住院出院摘要"]'); W(400)
    check('N4', '住院出院摘要需要出院日期', '出院日期出現輸入框，未確認前不能完成', pg.query_selector('#fv-2') is not None and pg.is_disabled('[data-act="review-done"]'))
    pg.fill('#fv-1', '腦中風後遺症（右側無力）、高血壓'); pg.fill('#fv-2', '2026-11-04'); pg.fill('#fv-3', '鼻胃管')
    pg.click('[data-act="f-quick"][data-i="4"][data-q="文件未記載"]'); W(200); pg.click('[data-act="f-quick"][data-i="5"][data-q="無"]'); W(200)
    confirm_all(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    v = store('items/' + I('summary'))['versions'][0]; rv = {r['k']: r for r in v['review']}
    check('N5', '「文件未記載」照實保存', '藥物過敏記為「文件未記載」並標示無資料，不會變成「無已知過敏」', v['fields']['allergy'] == '文件未記載' and rv['allergy']['absent'] == '文件未記載' and rv['allergy']['state'] == '已確認', rv['allergy'])
    check('N6', '每欄保留來源、原始值、確認狀態、確認人與 FHIR 對應', '例：主要診斷的原始值、來源「人工輸入」、確認人黃護理師、預計對應 Condition', rv['dx']['raw'] == '腦中風後遺症（右側無力）、高血壓' and rv['dx']['src'] == '人工輸入' and rv['dx']['okBy'] == 'nurse@example.com' and rv['dx']['fhir'] == 'Condition' and v.get('fhir') is None, rv['dx'])
    nav('doc', I('summary')); t = main()
    check('N7', '文件頁顯示資料層次', '原始文件／AI 辨識結果／人工確認資料／FHIR：尚未介接（沒有從醫院取得任何 FHIR 資料）；表格有「預計 FHIR」', 'FHIR 結構化資料：尚未介接' in t and '沒有從醫院取得任何 FHIR 資料' in t and '預計 FHIR' in t, t[:300])
    # 用藥：AI 辨識結果仍要逐欄確認，原始值保留
    nav('review', I('meds')); E("window.__ocrNext = {meds:['Aspirin 100 mg 每日一次'], note:''}"); pg.click('#ocrBtn'); W(1500)
    pg.fill('#fv-0', 'Aspirin 100 mg 每日一次 經鼻胃管'); pg.click('[data-act="f-quick"][data-i="1"][data-q="文件未記載"]'); W(200); confirm_all(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    rv = {r['k']: r for r in store('items/' + I('meds'))['versions'][0]['review']}
    check('N8', 'AI 辨識後人工修改', '原始值保留 AI 原文，確認值為修改後內容，來源標示「AI 辨識（第 1 次）後人工修改」', rv['meds']['raw'] == 'Aspirin 100 mg 每日一次' and rv['meds']['after'] == 'Aspirin 100 mg 每日一次 經鼻胃管' and '人工修改' in rv['meds']['src'], rv['meds'])
    # ===== 護理補充評估（醫院沒有獨立傷口紀錄） =====
    nav('resident', A)
    check('S1', '負責住民頁提供「護理補充評估」', '傷口照護資料（需要、未上傳）有按鈕；已上傳的文件沒有', pg.query_selector(f'[data-act="go"][data-page="supp"][data-arg="{I("woundCare")}"]') is not None and pg.query_selector(f'[data-act="go"][data-page="supp"][data-arg="{I("summary")}"]') is None)
    nav('supp', I('woundCare')); pg.click('#suppForm button[type=submit]'); W(300)
    check('S2', '補充評估一定要有來源', '沒有選來源時擋下', '來源' in pg.inner_text('#spErr'))
    pg.check('#suppForm input[name=src][value="電話詢問來源醫院護理站"]'); pg.fill('#suppForm [name=note]', '聯絡仁心醫院 7A 護理站'); pg.fill('#suppForm [name=f-woundCare]', '薦骨第 2 級壓傷 3×2 公分，每日換藥一次'); pg.check('#suppForm [name=ok]')
    pg.click('#suppForm button[type=submit]'); pg.wait_for_function("route.page === 'resident'", timeout=15000); W(500)
    v = store('items/' + I('woundCare'))['versions'][0]
    check('S3', '儲存護理補充評估', '傷口照護資料「確認符合」；版本沒有檔案、標示來源「護理補充評估：電話詢問來源醫院護理站」與確認人', st('woundCare') == '確認符合' and v['file'] is None and v['supp']['src'] == '電話詢問來源醫院護理站' and v['review'][0]['src'].startswith('護理補充評估') and v['nurseBy'] == 'nurse@example.com', v.get('supp'))
    nav('doc', I('woundCare')); t = main()
    check('S4', '補充評估的文件頁', '原始文件區說明「沒有原始文件：由護理人員補充評估」與來源；資料層次標示無獨立文件', '由護理人員補充評估' in t and '無獨立文件（護理補充評估）' in t)
    # ===== 收治評估：DNR 另行確認 =====
    nav('review', I('tubeCare')); pg.fill('#fv-0', '鼻胃管 16Fr，每月更換'); confirm_all(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    login('family@example.com'); upload('nhi', '02_健保卡_張秀英')
    login('staff@example.com'); nav('receipt', I('nhi')); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '相符'); pg.fill('#birthRaw', '029/06/12'); pg.check('#receiptForm [name=content]'); pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse@example.com')
    check('D1', '案件進入評估', '必要文件都確認後為「評估中」', E(f"phase(D.cases['{A}'])") == '評估中', E(f"phase(D.cases['{A}'])"))
    nav('assess', A); t = main()
    check('D2', '評估頁的 DNR', '顯示「尚未另行確認（病歷摘要沒有記載不代表未簽署）」，不從病摘推定', '尚未另行確認（病歷摘要沒有記載不代表未簽署）' in t)
    pg.select_option('#assessForm [name=dnr]', '已確認：未簽署'); pg.check('#assessForm input[name=result][value="收治"]'); pg.click('#assessForm button[type=submit]'); W(300)
    check('D3', 'DNR 選「已確認」必須填來源', '擋下並提示填寫確認來源', '確認來源' in pg.inner_text('#asErr'))
    pg.fill('#assessForm [name=dnrSrc]', '家屬表示未簽署，已請家屬確認健保卡註記'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(600)
    a = store('cases/' + A)['assessment']
    check('D4', 'DNR 與來源記在評估紀錄', '狀態與來源分別保存', a['dnr'] == {'state': '已確認：未簽署', 'src': '家屬表示未簽署，已請家屬確認健保卡註記'}, a.get('dnr'))
    # ===== 體檢報告：包含與結果分開 =====
    login('staff@example.com'); nav('case', A); pg.click('main [data-act="signed"]'); W(300)
    if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
    W(1200)
    login('family@example.com'); nav('upload', A, I('exam')); pg.set_input_files('#file', {'name': 'e.png', 'mimeType': 'image/png', 'buffer': IMG('08_體檢報告_張秀英')}); pg.fill('#examDate', '2026-11-05'); pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000)
    login('staff@example.com'); nav('receipt', I('exam')); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '相符'); pg.fill('#birthRaw', '1940/06/12'); pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    nav('date', I('exam')); pg.fill('#dateVal', '2026-11-05'); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse@example.com'); nav('review', I('exam'))
    q = E("reviewState.fields.find(f => f.k === 'p_cbc').quick")
    check('E1', '「是否包含」不再附帶「結果正常」', '選項只有「報告內有／報告內未包含」，不能一鍵認定正常', q == ['報告內有', '報告內未包含'], q)
    check('E2', '結果欄在選「報告內有」前不適用', '血液常規的結果欄尚未出現輸入框', E("reviewState.fields.findIndex(f => f.k === 'p_cbc_r')") and pg.query_selector('#fv-' + str(E("reviewState.fields.findIndex(f => f.k === 'p_cbc_r')"))) is None)
    for k in ['cbc', 'liver', 'kidney', 'glu', 'lyte', 'urine', 'infect', 'other']:
        i = E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}')"); pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="報告內有"]'); W(150)
    ri = E("reviewState.fields.findIndex(f => f.k === 'p_glu_r')")
    pg.fill(f'#fv-{ri}', '血糖 118'); pg.click(f'[data-act="f-ok"][data-i="{ri}"]'); W(300)
    check('E3', '檢查結果格式檢查', '「血糖 118」沒有單位與參考區間，被擋下並說明格式', '格式不正確' in pg.inner_text(f'#fe-{ri}'), pg.inner_text(f'#fe-{ri}'))
    pg.fill(f'#fv-{ri}', '空腹血糖｜118｜mg/dL｜70–99｜H')
    for k, v in {'cbc': 'WBC｜6.2｜10^3/µL｜4.0–10.0｜無\nHb｜11.2｜g/dL｜12–16｜L', 'liver': '文字判讀：正常', 'kidney': 'Creatinine｜0.9｜mg/dL｜0.6–1.2', 'lyte': '文字判讀：正常', 'urine': '文字判讀：正常', 'infect': '文字判讀：B、C 型肝炎陰性', 'other': '文字判讀：心電圖竇性心律'}.items():
        pg.fill('#fv-' + str(E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}_r')")), v)
    pg.click('[data-act="f-quick"][data-i="' + str(E("reviewState.fields.findIndex(f => f.k === 'examNote')")) + '"][data-q="文件未記載"]'); W(200)
    confirm_all(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(400)
    v = store('items/' + I('exam'))['versions'][0]
    check('E4', '檢查數值結構化保存', '血液常規存成兩筆（WBC 無異常、Hb L）；腎功能未寫異常記為「未判讀」；文字判讀照原文保存', v['labs']['p_cbc_r'][1] == {'name': 'Hb', 'value': '11.2', 'unit': 'g/dL', 'ref': '12–16', 'flag': 'L'} and v['labs']['p_kidney_r'][0]['flag'] == '未判讀' and v['labs']['p_liver_r'][0] == {'text': '正常'} and v['fields']['p_cbc'] == '報告內有', v.get('labs'))
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_r.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
