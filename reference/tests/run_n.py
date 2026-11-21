"""D 類照護紀錄（管路、傷口、吞嚥）的需求判斷改由負責護理師負責。"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
A = 'C-0001-p4t8'; I = lambda k, c=A: f'{c}_{k}'
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
    main = lambda: pg.inner_text('main'); clr = lambda: E("document.getElementById('toasts').innerHTML = ''")
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
    def judge(c, key, val, note, expect_ok=True):
        nav('resident', c); pg.click(f'[data-act="need-edit"][data-item="{I(key, c)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
        if not expect_ok: msg = pg.inner_text('#merr'); pg.click('[data-act="modal-cancel"]') if pg.query_selector('[data-act="modal-cancel"]') else None; W(200); return msg
        return ''
    def upload(key, img, c=A):
        nav('upload', c, I(key, c)); pg.set_input_files('#file', {'name': img + '.png', 'mimeType': 'image/png', 'buffer': IMG(img)}); pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    def receipt(key, birth, nid=True):
        nav('receipt', I(key)); pg.select_option('#receiptForm [name=m-name]', '相符'); pg.select_option('#receiptForm [name=m-nid]', '相符' if nid else '沒有'); pg.fill('#birthRaw', birth); W(150)
        if not pg.is_hidden('#manualBox'): pg.check('#manualBox input[name=how] >> nth=0')
        if pg.query_selector('#receiptForm [name=content]'): pg.check('#receiptForm [name=content]')
        pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def review(key, fill):
        nav('review', I(key))
        for i, v in fill.items():
            if v.startswith('@'): pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="{v[1:]}"]'); W(200)
            else: pg.fill(f'#fv-{i}', v)
        for _ in range(60):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(60)
        pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    NK = ['tubeCare', 'woundCare', 'swallow']
    # 準備：確認申請、授權
    login('staff@example.com'); nav('apply', A); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(A, 'nurse@example.com')
    login('family@example.com'); nav('consent', A); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)")
    rows = E("Object.fromEntries([...document.querySelectorAll('#docList .drow')].map(r => [r.querySelector('.t-name').textContent, r.textContent]))")
    check('T1', '家屬看到 D 類三項「待護理確認」', '管路、傷口、吞嚥都顯示「待護理確認」（完整清單改為唯讀，「先上傳現有文件」在案件首頁「等待本中心判斷」區）；不列入目前要做的事', all('待護理確認' in rows[n] for n in ['管路照護資料', '傷口照護資料', '吞嚥與飲食資料']) and E("document.querySelectorAll('#fullDocList button').length") == 0 and not E(f"activeItems(D.cases['{A}']).some(i => ['tubeCare','woundCare','swallow'].includes(i.key) && familyTodo(i, D.cases['{A}']))"), rows.get('管路照護資料'))
    # 行政
    login('staff@example.com'); nav('case', A); t = main()
    btns = E("[...document.querySelectorAll('main [data-act=need-edit]')].map(b => b.dataset.item.split('_').pop())")
    check('T2', '行政畫面沒有三項的判斷按鈕', '只剩戶籍證明可由行政判斷；三項顯示「待護理確認」與「由負責護理師判斷，行政不能修改」', btns == ['relProof'] and t.count('待護理確認') >= 3 and '由負責護理師判斷，行政不能修改' in t, (btns, t.count('待護理確認')))
    clr(); E(f"ACT['need-edit']({{dataset:{{item:'{I('tubeCare')}'}}}})"); W(300); toast = pg.inner_text('#toasts')
    check('T3', '行政直接呼叫判斷功能也會被拒絕', '提示由負責護理師判斷，沒有開啟視窗、資料不變', '由負責護理師判斷' in toast and not pg.query_selector('.dialog') and store('items/' + I('tubeCare'))['condMet'] is None, toast)
    stt = E(f"tasks().filter(t => t.c && t.c.id === '{A}').map(t => t.tag)")
    check('T4', '行政工作清單不列三項的判斷', '沒有「要求」類工作', '要求' not in stt, stt)
    # 護理：文件還沒收件就能判斷
    login('nurse@example.com')
    tk = E(f"tasks().filter(t => t.c && t.c.id === '{A}').map(t => t.tag + ':' + t.what)")
    check('T5', '護理在文件尚未上傳時就看到案件', '工作清單有「照護文件需求確認：張秀英」；負責住民有張秀英', any(x.startswith('需求:') for x in tk) and '張秀英' in (nav('residents') or main()), tk)
    nav('resident', A); t = main()
    check('T6', '負責住民頁的「照護文件需求確認」', '列出管路、傷口、吞嚥三項，都是「待護理確認」並有「判斷」按鈕；說明不是收治評估', pg.query_selector('#needCard') is not None and len(pg.query_selector_all('#needCard [data-act=need-edit]')) == 3 and '這不是收治評估' in pg.inner_text('#needCard'))
    nav('assess', A)
    check('T7', '不能提前做收治評估', '收治評估頁顯示「目前不能評估」', '目前不能評估' in main())
    pg.click(f'[data-act="go"][data-page="resident"]') if False else None
    nav('resident', A); pg.click(f'[data-act="need-edit"][data-item="{I("woundCare")}"]'); W(200)
    opts = E("[...document.querySelectorAll('input[name=needSel]')].map(x => x.closest('label').querySelector('strong').textContent)")
    check('T8', '護理判斷視窗', '三個選項：本案需要／本案不需要／尚待確認；備註欄為「判斷依據／備註」', opts == ['本案需要', '本案不需要', '尚待確認'] and '判斷依據／備註' in pg.inner_text('.dialog'), opts)
    pg.check('input[name=needSel][value="no"]'); pg.click('[data-act="modal-ok"]'); W(400); e = pg.inner_text('#merr')
    check('T9', '選「本案不需要」必須寫原因', '擋下並提示寫簡短原因', '原因' in e, e); pg.click('[data-act="modal-cancel"]'); W(200)
    m = judge(A, 'swallow', 'null', '', expect_ok=False)
    check('T10', '資訊不足時保留「尚待確認」', '沒有變更不會被強迫選擇（提示判斷沒有變更）；仍是待護理確認', '沒有變更' in m and E(f"condPending(D.items['{I('swallow')}'])"), m)
    judge(A, 'swallow', 'null', '等家屬提供語言治療評估')
    sw = store('items/' + I('swallow'))
    check('T11', '尚待確認也可記錄備註', '狀態仍待護理確認，歷程新增一筆含備註的紀錄', sw['condMet'] is None and sw['needHist'][-1]['note'] == '等家屬提供語言治療評估' and sw['needHist'][-1]['to'] == '待護理確認', sw.get('needHist'))
    judge(A, 'tubeCare', 'yes', '')
    judge(A, 'woundCare', 'no', '家屬表示沒有傷口')
    tc, wc = store('items/' + I('tubeCare')), store('items/' + I('woundCare'))
    check('T12', '護理判斷並留下紀錄', '管路「護理已確認：需要」（依據可留空）、傷口「護理已確認：不需要」；記錄判斷人員、時間、依據與角色', tc['condMet'] is True and tc['needSetBy'] == 'nurse@example.com' and tc['needRole'] == 'nurse' and wc['condMet'] is False and wc['needNote'] == '家屬表示沒有傷口' and wc['needHist'][-1]['to'] == '護理已確認：不需要' and wc['needHist'][-1]['by'] == 'nurse@example.com' and bool(wc['needSetAt']), (tc.get('needHist'), wc.get('needHist')))
    # 同步到家屬與行政
    login('family@example.com'); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)")
    rows = E("Object.fromEntries([...document.querySelectorAll('#docList .drow')].map(r => [r.querySelector('.t-name').textContent, r.textContent]))")
    todo = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.key)")
    check('T13', '判斷結果同步到家屬畫面', '管路「本案需要繳交」並列入待辦；傷口「本案不需繳交」沒有上傳按鈕；吞嚥仍「待護理確認」', '本案需要繳交' in rows['管路照護資料'] and 'tubeCare' in todo and '本案不需繳交' in rows['傷口照護資料'] and '上傳' not in rows['傷口照護資料'] and '待護理確認' in rows['吞嚥與飲食資料'] and 'swallow' not in todo and 'woundCare' not in todo, (todo, rows['傷口照護資料']))
    login('staff@example.com'); nav('case', A); t = main()
    stt = E(f"tasks().filter(t => t.c && t.c.id === '{A}' && t.tag === '通知').map(t => t.what)")
    tr = store('items/' + I('tubeCare')).get('req') or {}
    check('T14', '判斷結果同步到行政畫面（客戶回饋後：自動補件）', '案件頁顯示「護理已確認：需要／不需要」與判斷者；系統已依護理判斷自動建立管路的補件要求，行政工作清單不再要求手動通知', '護理已確認：需要' in t and '護理已確認：不需要' in t and '黃護理師 判斷' in t and stt == [] and tr.get('auto') is True and not tr.get('closedAt'), (stt, tr))
    pg.click('main [data-act="staff-request"]'); W(300); pg.check(f'input[name=srItem][value="{I("tubeCare")}"]'); pg.fill('#srNote', '護理師確認需要管路照護資料，請提供出院護理指導單'); pg.click('[data-act="modal-ok"]'); W(1500)
    stt = E(f"tasks().filter(t => t.c && t.c.id === '{A}' && t.tag === '通知').length")
    check('T15', '行政通知家屬並追蹤', '補件通知送出、補件請求開啟，通知提醒消失；補件追蹤列出管路照護資料', stt == 0 and bool(store('items/' + I('tubeCare')).get('req')) and any('管路照護資料' in (n.get('text') or '') for n in [store(k) for k in E("[...window.__store.keys()].filter(k => k.startsWith('notices/'))")]) and ('管路留置與照護紀錄' in (nav('followup') or main())), stt)
    # 家屬上傳：需要的與尚待確認的
    login('family@example.com')
    upload('idcopy', '01_身分證影本_張秀英'); upload('nhi', '02_健保卡_張秀英'); upload('summary', '03_出院病歷摘要_張秀英'); upload('meds', '04_用藥清單_張秀英')
    upload('tubeCare', '06_管路照護指導_張秀英'); upload('swallow', '07_吞嚥評估_張秀英')
    check('T16', '判定需要後家屬正常上傳；尚待確認也能先上傳', '管路第 1 版「待收件」（補傳不等於完成）；吞嚥（尚待確認）第 1 版也保存', st('tubeCare') == '待收件' and len(store('items/' + I('swallow'))['versions']) == 1 and not store('items/' + I('tubeCare'))['req'].get('closedAt'), (st('tubeCare'), st('swallow')))
    login('staff@example.com')
    receipt('idcopy', '民國 29 年 6 月 12 日'); receipt('nhi', '029/06/12'); receipt('summary', '1940/06/12'); receipt('meds', '1940/06/12'); receipt('tubeCare', '1940/06/12', nid=False); receipt('swallow', '1940/06/12')
    login('nurse@example.com')
    review('summary', {0: '@住院出院摘要', 1: '腦中風後遺症（右側無力）、高血壓', 2: '2026-11-04', 3: '鼻胃管', 4: '磺胺類藥物（皮疹）', 5: '@無'})
    review('meds', {0: 'Aspirin 100 mg 每日一次', 1: '@文件未記載'}); review('tubeCare', {0: '鼻胃管 16Fr，每月更換'}); review('swallow', {0: '@管灌，不可由口進食'})
    check('T17', '尚待確認時不算文件齊全', '其他評估前文件都確認符合、吞嚥也已核對，但吞嚥仍「待護理確認」，案件不進入「評估中」', ph() != '評估中' and E(f"condPending(D.items['{I('swallow')}'])"), ph())
    judge(A, 'swallow', 'no', '改由醫師評估後不需要吞嚥資料')
    sw = store('items/' + I('swallow'))
    check('T18', '已上傳的文件改判「不需要」', '案件進入「評估中」；吞嚥狀態「不需要」，已上傳的檔案與核對紀錄保留', ph() == '評估中' and st('swallow') == '不需要' and len(sw['versions']) == 1 and sw['versions'][0].get('nurseOk'), (ph(), st('swallow')))
    judge(A, 'swallow', 'yes', '再次確認仍為管灌，需要吞嚥資料')
    sw = store('items/' + I('swallow'))
    check('T19', '修改判斷保留歷程', '吞嚥改回需要：歷程 3 筆（尚待確認＋備註 → 不需要 → 需要），已核對的版本直接沿用為「確認符合」', len(sw['needHist']) == 3 and [h['to'] for h in sw['needHist']] == ['待護理確認', '護理已確認：不需要', '護理已確認：需要'] and st('swallow') == '確認符合' and ph() == '評估中', [h['to'] for h in sw['needHist']])
    # 情境 A／B：已開放摘要卡的案件（測試案件 D）
    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed-missing"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(800)
    D_ = 'TEST-D'
    login('nurse@example.com')
    check('T20', '測試案件仍可使用', '測試案件 D 摘要卡已開放，三項判斷由護理紀錄', ph(D_) == '摘要卡已開放' and store('items/TEST-D_tubeCare')['needRole'] == 'nurse')
    judge(D_, 'tubeCare', 'yes', '入住前訪視發現有鼻胃管')
    tk = E("tasks().filter(t => t.c && t.c.id === 'TEST-D').map(t => t.tag)")
    check('T21', '情境 A：不需要 → 需要', '管路改為「本案需要」並成為缺件（案件回到「待補件」）；護理工作清單出現摘要卡需要重新審核，提示「管路照護資料」；原判斷保留在歷程', E("isNeeded(D.items['TEST-D_tubeCare'])") and st('tubeCare', D_) == '未上傳' and ph(D_) == '待補件' and '管路照護資料' in E("cardChanged(D.cases['TEST-D']).join()") and len(store('items/TEST-D_tubeCare')['needHist']) == 2 and '摘要卡' in tk, (ph(D_), tk))
    login('staff@example.com'); stt = E("tasks().filter(t => t.c && t.c.id === 'TEST-D' && t.tag === '通知').length")
    rq = store('items/TEST-D_tubeCare').get('req') or {}
    check('T22', '情境 A：系統自動通知家屬補件（客戶回饋後）', '管路改為需要後，系統自動建立補件要求並通知家屬，行政不必再提醒', stt == 0 and rq.get('auto') is True and any('管路照護資料' in (store(k).get('text') or '') and store(k).get('caseId') == 'TEST-D' for k in E("[...window.__store.keys()].filter(k => k.startsWith('notices/'))")), (stt, rq))
    login('care@example.com'); nav('card', D_); t = main()
    check('T23', '情境 A：照服員畫面', '顯示「資料已更新」，管路欄改為「請問護理站」', '資料已更新' in t and '請問護理站' in t)
    login('nurse@example.com'); nav('supp', 'TEST-D_tubeCare'); pg.check('#suppForm input[name=src][value="入住前訪視或評估"]'); pg.fill('#suppForm [name=note]', '入住前訪視時確認'); pg.fill('#suppForm [name=f-tubeCare]', '鼻胃管 14Fr，左鼻孔，每月更換'); pg.check('#suppForm [name=ok]'); pg.click('#suppForm button[type=submit]'); pg.wait_for_function("route.page === 'resident'", timeout=15000); W(500)
    check('T24a', '情境 A：沒有醫院紀錄時用護理補充評估補上', '管路照護資料確認符合，案件回到「摘要卡待重新審核」', st('tubeCare', D_) == '確認符合' and ph(D_) == '摘要卡待重新審核', ph(D_))
    nav('resident', D_); pg.click('[data-act="card-revise"]'); W(1200); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(600)
    check('T24', '護理重新確認後摘要卡恢復', '第 2 版開放後不再提示', ph(D_) != '摘要卡待重新審核' and E("cardChanged(D.cases['TEST-D']).length") == 0, ph(D_))
    sw0 = store('items/TEST-D_swallow')
    judge(D_, 'swallow', 'no', '吞嚥功能已恢復，可一般飲食')
    sw1 = store('items/TEST-D_swallow')
    check('T25', '情境 B：需要 → 不需要', '吞嚥改為「本案不需繳交」不列缺件；原上傳檔案與核對紀錄完全保留；摘要卡提示重新確認「吞嚥與飲食」', st('swallow', D_) == '不需要' and sw1['versions'] == sw0['versions'] and sw1['versions'][0].get('nurseOk') and '吞嚥與飲食' in E("cardChanged(D.cases['TEST-D']).join()") and not E("familyTodo(D.items['TEST-D_swallow'], D.cases['TEST-D'])"), E("cardChanged(D.cases['TEST-D'])"))
    # 寫入失敗
    E("window.__failWrite = 'items/'"); nav('resident', D_); pg.click('[data-act="need-edit"][data-item="TEST-D_woundCare"]'); W(200); pg.check('input[name=needSel][value="yes"]'); pg.fill('#needNote', '發現薦骨壓傷'); clr(); pg.click('[data-act="modal-ok"]'); W(1200); E("window.__failWrite = null")
    e = pg.inner_text('#merr') if pg.query_selector('#merr') else ''
    check('T26', '資料寫入失敗時不會假成功', '視窗顯示失敗原因、沒有「已更新」；傷口判斷仍為不需要', bool(e) and '已更新' not in pg.inner_text('#toasts') and store('items/TEST-D_woundCare')['condMet'] is False and E("D.items['TEST-D_woundCare'].condMet") is False, e)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_n.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
