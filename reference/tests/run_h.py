"""第 (8) 版：摘要卡狀態訊息與不承諾時限文字的驗收測試。"""
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



    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed-missing"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=90000); W(800)
    hero = lambda: pg.inner_text('#cardStateHero') if pg.query_selector('#cardStateHero') else ''
    login('family@example.com'); nav('home', 'TEST-C'); h1 = hero()
    check('H1', '摘要卡審核中不顯示入住準備完成', '測試案件 C（摘要卡待審核）家屬看到「文件已確認，照顧團隊準備中」，說明護理師審核中，沒有「入住準備完成」', ph('TEST-C') == '摘要卡審核中' and '照顧團隊準備中' in h1 and '入住準備完成' not in main(), h1)
    login('family2@example.com'); nav('home', 'TEST-D'); h2 = hero()
    check('H2', '摘要卡已開放才顯示入住準備完成', '測試案件 D（摘要卡已開放）家屬看到「入住準備完成」', ph('TEST-D') == '摘要卡已開放' and '入住準備完成' in h2, h2)
    nav('life', 'TEST-D', '0'); pg.fill('#habitForm [name=call]', '月娥阿嬤'); pg.click('#habitForm button[value="stay"]'); W(1200)
    hab_submit('TEST-D')
    nav('home', 'TEST-D'); h3 = hero()
    check('H3', '摘要卡待重新審核的訊息', '家屬修改習慣卡後，案件「摘要卡待重新審核」，家屬看到「資料已更新，護理師重新確認中」，不是「入住準備完成」', ph('TEST-D') == '摘要卡待重新審核' and '重新確認中' in h3 and '入住準備完成' not in main(), (ph('TEST-D'), h3))
    login('care@example.com'); nav('card', 'TEST-D'); cv = main()
    check('H4', '照服員查看權限與重新審核機制不變', '照服員仍可查看摘要卡，受影響欄位顯示「請問護理站」', '資料已更新' in cv and '請問護理站' in cv)
    login('nurse@example.com'); nav('card', 'TEST-C'); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    login('family@example.com'); nav('home', 'TEST-C'); h5 = hero()
    check('H5', '護理正式確認後才變成入住準備完成', '護理審核並開放測試案件 C 的摘要卡後，家屬才看到「入住準備完成」', ph('TEST-C') == '摘要卡已開放' and '入住準備完成' in h5, h5)
    # 不承諾固定時限
    texts = []
    login('family3@example.com'); nav('apply'); texts.append(main())
    fill_apply('劉春梅', 'K287654321', '1943-02-03', '兒子', '2026-12-10'); pg.click('#applyPreviewForm button[type=submit]'); W(3000); texts.append(main())
    cid = E("route.arg"); nav('home', cid); texts.append(main())
    nav('home', 'TEST-A'); texts.append(main())
    login('staff@example.com'); nav('apply', cid); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500)
    login('family3@example.com'); consent(cid); upload(cid, 'idcopy', '01_身分證影本_張秀英'); texts.append(main()); nav('home', cid); texts.append(main())
    allt = '\n'.join(texts)
    check('H6', '不承諾固定時限', '申請表、成功頁、待行政確認、文件審查中、上傳完成等家屬畫面都沒有「1 個工作天」「1–2 個工作天」，改為依本中心作業安排的說明', '工作天' not in allt and '依本中心作業安排' in allt and '工作天' not in E("document.documentElement.innerHTML"), [l for l in allt.splitlines() if '工作天' in l][:3])
    src = open('/home/claude/simp/index.html', encoding='utf-8').read()
    check('H7', '原始碼中沒有固定時限承諾（靜態檢查）', 'HTML 原始碼不再出現「工作天」', '工作天' not in src)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_h.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
