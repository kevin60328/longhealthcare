"""第 (7) 版五項小範圍補強的驗收測試。"""
import json, sys, re
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
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
    pg.goto('file:///home/claude/simp/index.html'); pg.wait_for_selector('#portal')
    W = lambda ms=500: pg.wait_for_timeout(ms); E = lambda js: pg.evaluate(js)
    store = lambda path: E(f"(() => {{ const d = window.__store.get('{path}'); return d ? JSON.parse(JSON.stringify(d)) : null; }})()")
    keys = lambda pre: E(f"[...window.__store.keys()].filter(k => k.startsWith('{pre}'))")
    st = lambda k, c=A: E(f"status(D.items['{I(k, c)}'], D.cases['{c}'])")
    ph = lambda c=A: E(f"phase(D.cases['{c}'])")
    main = lambda: pg.inner_text('main')
    CUR = [None]
    def logout():
        if pg.query_selector('[data-act="logout"]'): pg.click('[data-act="logout"]'); W(300); pg.wait_for_selector('#portal')
    def login(e, portal=None):
        CUR[0] = e; logout()
        portal = portal or ('applicant' if e.startswith('family') or e.startswith('new') or e.startswith('kid') else 'staff')
        E(f"go('login', '{portal}')"); pg.fill('#loginForm [name=email]', e); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); pg.wait_for_selector('#top [data-act="logout"]', timeout=15000); W(400)
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
        if pg.query_selector('#birthRaw') and birth: pg.fill('#birthRaw', birth)
        W(150)
        if not pg.is_hidden('#manualBox'): pg.check('#manualBox input[name=how] >> nth=0')
        if pg.query_selector('#receiptForm [name=content]'): pg.check('#receiptForm [name=content]')
        pg.click('#receiptForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def all_ok():
        for _ in range(80):
            if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
            pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(50)
    def review(c, key, quick=None, fill=None):
        nav('review', I(key, c))
        for i, q in (quick or {}).items(): pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="{q}"]'); W(150)
        for i, v in (fill or {}).items(): pg.fill(f'#fv-{i}', v)
        all_ok(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def review_exam(c):
        nav('review', I('exam', c))
        for k in ['cbc', 'liver', 'kidney', 'glu', 'lyte', 'urine', 'infect', 'other']:
            i = E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}')"); pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="報告內有"]'); W(100)
            pg.fill('#fv-' + str(E(f"reviewState.fields.findIndex(f => f.k === 'p_{k}_r')")), '文字判讀：正常')
        pg.click('[data-act="f-quick"][data-i="' + str(E("reviewState.fields.findIndex(f => f.k === 'examNote')")) + '"][data-q="文件未記載"]'); W(100)
        all_ok(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    def judge(c, key, val, note):
        nav('resident', c); pg.click(f'[data-act="need-edit"][data-item="{I(key, c)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(1200)
    def consent(c):
        nav('consent', c); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    def assign_ui(c, n, reason=''):
        nav('assign'); pg.click(f'[data-act="assign-nurse"][data-case="{c}"]'); W(200); pg.select_option('#asNurse', n); pg.fill('#asReason', reason); pg.click('[data-act="modal-ok"]'); W(1500)
    def register(email, name, phone):
        logout(); E("go('register', 'applicant')")
        for k, v in [('name', name), ('email', email), ('phone', phone), ('pw', 'Test1234'), ('pw2', 'Test1234')]: pg.fill(f'#regForm [name={k}]', v)
        pg.click('#regForm button[type=submit]'); pg.wait_for_selector('#top [data-act="logout"]', timeout=15000); W(500); CUR[0] = email
    def fill_apply(name, nid, birth, rel='兒子', admit='2026-12-20', hosp=''):
        pg.fill('#applyForm [name=pname]', name); pg.fill('#applyForm [name=nid]', nid); pg.fill('#applyForm [name=birth]', birth); pg.select_option('#applyForm [name=relation]', rel); pg.fill('#applyForm [name=hospital]', hosp); pg.fill('#applyForm [name=admit]', admit)
        pg.click('#applyForm button[type=submit]'); W(400)
    ncases = lambda: len(keys('cases/'))


    # 1. 無案件家屬
    login('family3@example.com')
    check('G1', '無案件家屬登入後進入個人首頁', '個人首頁有三個入口與「目前尚無入住申請」', pg.query_selector('#personalHome') is not None and pg.query_selector('#noCase') is not None and all(x in main() for x in ['我要申請入住', '我的申請紀錄', '申請流程說明']))
    # 3. 成功頁兩個按鈕
    nav('apply'); fill_apply('劉春梅', 'K287654321', '1943-02-03', '兒子', '2026-12-10'); pg.click('#applyPreviewForm button[type=submit]'); W(3000)
    cid = E("route.arg")
    pg.click('#appliedPage [data-page="home"]:not([data-arg]), #appliedPage button[data-page="home"][data-arg=""]'); W(400)
    p1 = pg.query_selector('#personalHome') is not None and '劉春梅' in pg.inner_text('#myCaseList')
    E(f"go('applied', '{cid}')"); W(300); pg.click(f'#appliedPage [data-page="home"][data-arg="{cid}"]'); W(400)
    p2 = pg.query_selector('#personalHome') is None and '劉春梅的入住申請' in main() and E("route.arg") == cid
    check('G3', '申請成功頁兩個按鈕導向不同頁面', '「返回個人首頁」到個人首頁（列出這筆申請）；「查看申請進度」到這筆案件的詳情', p1 and p2, (p1, p2))
    # 2. 已有案件家屬
    login('family@example.com')
    h = pg.query_selector('#personalHome') is not None and '張秀英' in pg.inner_text('#myCaseList')
    pg.click(f'#myCaseList [data-arg="{A}"]'); W(400); d1 = '張秀英的入住申請' in main()
    pg.click('main .back'); W(400); h2 = pg.query_selector('#personalHome') is not None
    check('G2', '已有案件家屬可返回個人首頁，再開啟案件詳情', '登入後是個人首頁並列出申請；按「查看進度」進入案件詳情；按「回到個人首頁」回到個人首頁', h and d1 and h2, (h, d1, h2))
    # 多案件切換仍在
    register('newfam@example.com', '王大明', '0955-123-456')
    for nm, nid in [('王小明', 'A123456789'), ('王小華', 'A223456781')]:
        nav('apply'); fill_apply(nm, nid, '1940-01-02'); pg.click('#applyPreviewForm button[type=submit]'); W(2500)
    nav('home', E("route.arg")); sw = pg.query_selector('#caseSwitch') is not None
    other = [k.split('/')[1] for k in keys('cases/') if store(k)['patient']['name'] == '王小明'][0]
    if sw: pg.select_option('#caseSwitch', other); W(400)
    check('G2b', '多案件切換功能保留', '案件詳情仍有「切換申請」，切換後顯示另一筆', sw and '王小明的入住申請' in main())
    # 利益衝突提示
    register('kid@example.com', '陳家人', '0911-000-002'); nav('apply'); fill_apply('陳老先生', 'B123456780', '1938-08-08', '其他親屬'); pg.click('#applyPreviewForm button[type=submit]'); W(2500)
    cid3 = E("route.arg")
    login('staff@example.com'); nav('apply', cid3); t = main(); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(1200)
    check('G9', '利益衝突提示標示為輔助判斷', '提示「疑似利益衝突」並說明是測試環境輔助判斷、不代表正式身分驗證、需由其他授權人員或管理員確認；仍不能自行確認', '疑似利益衝突' in t and '不代表正式身分驗證' in t and '系統管理員確認' in t and store('cases/' + cid3)['linkStatus'] == '待確認')
    # 先審後簽／先簽後審文件階段文字
    for c in [A, B]: nav('apply', c); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500)
    login('nurse@example.com'); assign_ui(A, 'nurse2@example.com'); assign_ui(B, 'nurse2@example.com')
    login('family2@example.com'); consent(B); nav('home', B)
    g = pg.inner_text('#docGroups'); full = (to_guide() or pg.text_content('#fullDocList'))
    check('G4', '先簽後審文件不會錯誤顯示為簽約後才準備', '先簽後審尚未簽約時：入住前文件標示「目前需要準備」，沒有「簽約後」字樣；完整清單說明本案入住前文件目前就要準備', '入住前文件（目前需要準備）' in g and '簽約後' not in g and '簽約後再準備' not in full and '本案為先簽後審' in full, g[:300])
    login('family@example.com'); consent(A); nav('home', A); g2 = pg.inner_text('#docGroups')
    check('G4b', '先審後簽尚未簽約的文字', '入住前文件列在「入住前文件（簽約後再準備）」', '入住前文件（簽約後再準備）' in g2 and '目前需要準備' not in g2)
    # 舊案件分配時間
    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed"][data-key="C"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=90000); W(800)
    login('staff@example.com'); nav('case', 'TEST-C'); t = main()
    tl = E("caseTimeline(D.cases['TEST-C']).filter(e => e.kind === 'assign').length")
    check('G5', '舊案件不會出現虛構的護理分配時間', '沒有分配歷程的舊案件：處理歷程沒有「護理案件已分配」事件，改顯示「舊流程已有承辦護理師，原始分配時間未記錄」；案件頁保留原承辦護理師', tl == 0 and '舊流程已有承辦護理師（黃護理師），原始分配時間未記錄' in pg.text_content('#timeline') and '原始分配時間未記錄' in pg.inner_text('#assignInfo') and '黃護理師' in pg.inner_text('#assignInfo'), tl)
    # 6. 重新分配後原承辦者
    login('nurse2@example.com'); judge(A, 'tubeCare', 'yes', '出院摘要記載鼻胃管')
    login('nurse@example.com'); assign_ui(A, 'nurse@example.com', '吳護理師請假')
    login('nurse2@example.com'); pg.click('[data-act="work-tab"][data-tab="done"]'); W(400); d = (E("document.querySelectorAll('#doneList details').forEach(d => d.open = true)") or pg.inner_text('#doneList'))
    tk = E(f"tasks().filter(t => t.c && t.c.id === '{A}').length")
    nav('resident', A); r1 = pg.query_selector('#needCard') is None
    nav('doc', I('summary')); r2 = '不是這位住民的負責護理師' in main()
    before = store('items/' + I('swallow'))
    E(f"ACT['need-edit']({{dataset:{{item:'{I('swallow')}'}}}})"); W(300); r3 = pg.query_selector('input[name=needSel]') is None and store('items/' + I('swallow')) == before
    check('G6', '重新分配後原承辦者仍可查詢自己的工作歷程', '吳護理師的「已完成」列出自己對張秀英做的需求判斷，標示「已移交」', '張秀英' in d and '文件需求判斷' in d and '已移交' in d, d[:300])
    check('G6b', '原承辦者不能修改已移交的醫療案件', '原承辦者的待處理沒有此案件、不能開啟住民資料與文件、不能做需求判斷', tk == 0 and r1 and r2 and r3, (tk, r1, r2, r3))
    login('nurse@example.com'); pg.click('[data-act="work-tab"][data-tab="done"]'); W(400); d2 = E(f"doneWork().filter(e => e.c.id === '{A}' && e.kind === 'need').map(e => e.by)")
    full = E(f"caseTimeline(D.cases['{A}']).filter(e => e.kind === 'need').length")
    check('G6c', '已完成依實際操作人員；案件完整歷程不受影響', '新承辦者的「已完成」不會把吳護理師做的判斷算成自己的；案件處理歷程仍保留這筆判斷', d2 == [] and full >= 1, (full, d2))
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_g.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
