"""測試資料功能：建立四筆測試案件、各角色從中途階段開始審核、重複建立、恢復起始狀態、寫入失敗、不自動覆蓋。"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('/home/claude/simp/seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
HTML = open('/home/claude/simp/index.html', encoding='utf-8').read()
results, errs = [], []
def check(t, n, expect, ok, actual=''):
    s = 'PASS' if ok is True else 'FAIL'
    results.append({'id': t, 'case': n, 'expect': expect, 'result': s, 'actual': '' if ok is True else str(actual)[:300]}); print(s, t, n, '' if ok is True else str(actual)[:300]); sys.stdout.flush()
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(seedobj):
        ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        ctx.add_init_script('window.__SEED=' + json.dumps(seedobj, ensure_ascii=False) + ';' + mock); ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errs.append(m.text))
        pg.goto('file:///home/claude/simp/index.html'); pg.wait_for_selector('#portal, #loginForm'); return pg
    pg = page(seed)
    W = lambda ms=500: pg.wait_for_timeout(ms); E = lambda js: pg.evaluate(js)
    store = lambda path: E(f"(() => {{ const d = window.__store.get('{path}'); return d ? JSON.parse(JSON.stringify(d)) : null; }})()")
    keys = lambda pre: E(f"[...window.__store.keys()].filter(k => k.startsWith('{pre}'))")
    snap = lambda: E("Object.fromEntries([...window.__store.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))")
    main = lambda: pg.inner_text('main')
    ph = lambda c: E(f"phase(D.cases['{c}'])"); st = lambda i: E(f"status(D.items['{i}'], D.cases[D.items['{i}'].caseId])")
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
    nontest = lambda S: {k: v for k, v in S.items() if not (k.startswith('logs/') or 'TEST-' in k or k.startswith('accounts/') or k.startswith('meta/') or (isinstance(v, dict) and str(v.get('caseId', '')).startswith('TEST-')))}

    check('T0', '測試資料只在手動操作時建立（靜態檢查）', '程式中 seedTestCase 只由「測試資料」頁的按鈕呼叫，啟動流程沒有呼叫；HTML 沒有密碼字串 Test1234', HTML.count('seedTestCase(') == 3 and 'Test1234' not in HTML, HTML.count('seedTestCase('))
    login('admin@example.com'); nav('testdata'); t = main()
    check('T1', '管理員「測試資料」頁', '標示「僅供測試」；列出 4 筆測試案件都「尚未建立」', '僅供測試' in t and t.count('尚未建立') == 4 and not keys('cases/TEST-'), t[:150])
    before = nontest(snap())
    pg.click('[data-act="test-seed-missing"]'); W(300); body = pg.inner_text('.dialog')
    pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(1000)
    check('T2', '建立尚未存在的測試案件', '確認視窗列出要建立的 4 筆；建立後有 TEST-A～TEST-D 四筆案件', '劉文雄' in body and len(keys('cases/TEST-')) == 4, keys('cases/TEST-'))
    imgs = [k for k in keys('files/') if (store(k) or {}).get('caseId', '').startswith('TEST-')]
    check('T3', '模擬文件是真的圖片', f'files/ 中有測試案件的 JPEG 圖片（{len(imgs)} 張），每張都有內容', len(imgs) >= 30 and all(store(k)['dataUrl'].startswith('data:image/jpeg') and len(store(k)['dataUrl']) > 20000 for k in imgs[:5]), len(imgs))
    ph0 = {c: ph(c) for c in ['TEST-A', 'TEST-B', 'TEST-C', 'TEST-D']}
    check('T4', '四筆案件的實際狀態（由 phase() 判斷）', 'A 評估中前的「文件審查中」、B「評估中」、C「摘要卡審核中」、D「摘要卡已開放」', ph0 == {'TEST-A': '文件審查中', 'TEST-B': '評估中', 'TEST-C': '摘要卡審核中', 'TEST-D': '摘要卡已開放'}, ph0)
    check('T5', '測試案件符合原本的判斷函式', '四筆 listOk、canProcess 都成立；A 的 7 份醫療文件是「待護理核對」、身分證與健保卡「確認符合」', all(E(f"listOk(D.cases['{c}']) && canProcess(D.cases['{c}'])") for c in ph0) and all(st('TEST-A_' + k) == '待護理核對' for k in ['summary', 'meds', 'tubeCare', 'woundCare', 'swallow', 'rehab', 'labs']) and st('TEST-A_idcopy') == '確認符合' and st('TEST-A_nhi') == '確認符合')
    nav('testdata'); t = main()
    check('T6', '建立後的測試資料頁', '四筆都改為「恢復起始狀態」並顯示目前狀態', E("[...document.querySelectorAll('[data-act=test-seed]')].filter(b => b.textContent === '恢復起始狀態').length") == 4 and '摘要卡已開放' in t)
    n0 = len(keys('')); pg.click('[data-act="test-seed-missing"]'); W(800)
    check('T7', '重複按「建立尚未存在的測試案件」', '提示都已存在，不新增任何資料', len(keys('')) == n0 and len(keys('cases/TEST-')) == 4, len(keys('')) - n0)
    check('T8', '建立測試資料不改動非測試案件', '張秀英、陳金水等原有案件、文件與設定完全相同', nontest(snap()) == before)
    # ===== 護理：案件 A 核對 =====
    login('nurse@example.com'); tk = E("tasks().filter(t => t.c && t.c.id === 'TEST-A' && t.tag === '核對').map(t => t.what)")
    check('A1', '護理登入後看到案件 A 的核對工作', '工作清單有劉文雄 7 份文件核對', len(tk) == 7, tk)
    nav('review', 'TEST-A_summary')
    hasimg = pg.query_selector('main img') is not None
    size = E("fileBlob(cur(D.items['TEST-A_summary']).file).then(b => b.size)")
    empty = E("reviewState.fields.every(f => !f.val && !f.ok)")
    check('A2', '案件 A 的醫療文件可以開啟閱讀', '原始文件區顯示模擬文件圖片；護理欄位全部空白、未確認', hasimg and size > 10000 and empty, (hasimg, size, empty))
    check('A3', '案件 A 可以使用 AI 辨識', '文件是圖片，畫面有「自動辨識」按鈕（實際辨識需在 Claude 中執行）', pg.query_selector('#ocrBtn') is not None)
    pg.click('[data-act="f-quick"][data-i="0"][data-q="住院出院摘要"]'); W(400)
    vals = {1: '腦梗塞後遺症（左側肢體無力）、高血壓、第二型糖尿病', 2: '2026-11-02', 3: '留置導尿管（Foley 16Fr）', 4: 'Penicillin（皮疹）', 5: '薦骨第 1 級壓傷'}
    for i, v in vals.items(): pg.fill(f'#fv-{i}', v)
    for _ in range(80):
        if not pg.query_selector("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"]"): break
        pg.click("[data-act=\"f-ok\"], [data-act=\"dxr-ok\"], #dxField:not(:has(tr.dxr)) [data-act=\"dxr-fromraw\"], #dxField:not(:has(tr.dxr)) [data-act=\"f-quick\"] >> nth=0"); W(60)
    pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(500)
    v = store('items/TEST-A_summary')['versions'][0]
    check('A4', '案件 A 實際執行護理人工核對', '出院摘要「確認符合」，欄位來源為「人工輸入」，確認人黃護理師', st('TEST-A_summary') == '確認符合' and v['fields']['tube'] == '留置導尿管（Foley 16Fr）' and v['nurseBy'] == 'nurse@example.com' and all(r['src'] == '人工輸入' for r in v['review']), v.get('reviewSrc'))
    nav('review', 'TEST-A_meds'); E("window.__ocrNext = {meds:['Amlodipine 5 mg 每日一次 早餐後','Metformin 500 mg 每日兩次 早晚餐後','Clopidogrel 75 mg 每日一次 早餐後','Atorvastatin 20 mg 每日一次 睡前'], note:'錠劑可磨粉，以增稠飲品配服'}"); pg.click('#ocrBtn'); W(1500)
    check('A5', '案件 A 辨識流程可走（本機以模擬辨識結果代入）', '欄位帶入並標示 AI 辨識，仍須逐欄確認', E("reviewState.fields.some(f => f.auto) && reviewState.fields.every(f => !f.ok)"))
    # ===== 案件 B：收治評估 =====
    tk = E("tasks().filter(t => t.c && t.c.id === 'TEST-B').map(t => t.tag)")
    check('B1', '護理直接看到案件 B 的收治評估', '工作清單有林玉蘭「評估」', tk == ['評估'], tk)
    nav('assess', 'TEST-B'); t = main()
    check('B2', '收治評估畫面帶入已確認資料', '顯示已確認的診斷、過敏（磺胺類藥物）、用藥；不是「目前不能評估」', '磺胺類藥物' in t and 'Losartan' in t and '目前不能評估' not in t, t[:200])
    pg.select_option('#assessForm [name=move]', '一人協助'); pg.check('#assessForm input[name=result][value="收治"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('B3', '案件 B 完成收治評估', '案件變成「已收治待簽約」', ph('TEST-B') == '已收治待簽約', ph('TEST-B'))
    # ===== 案件 C：摘要卡 =====
    tk = E("tasks().filter(t => t.c && t.c.id === 'TEST-C' && !t.opt).map(t => t.tag)")
    check('C1', '護理看到案件 C 的摘要卡審核', '工作清單有張榮發「摘要卡」（另有選擇性的習慣卡初審，不列入待辦數）', tk == ['摘要卡'], tk)
    nav('card', 'TEST-C'); t = pg.text_content('main')
    check('C2', '摘要卡草稿取得已確認資料與習慣卡', 'A 區過敏「Aspirin（氣喘）」、吞嚥「需流質或增稠」；B 區稱呼「榮伯」、作息、安撫方式；資料差異列出家屬所填「阿斯匹靈、蝦子」', 'Aspirin（氣喘）' in pg.input_value('#cardForm [name=allergy]') and '增稠' in pg.input_value('#cardForm [name=food]') and pg.input_value('#cardForm [name=call]') == '榮伯' and '06:00' in pg.input_value('#cardForm [name=routine]') and '握著手' in pg.input_value('#cardForm [name=soothe]') and '阿斯匹靈、蝦子' in t, pg.input_value('#cardForm [name=food]'))
    pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('C3', '護理開放案件 C 的摘要卡', '案件「摘要卡已開放」', ph('TEST-C') == '摘要卡已開放', ph('TEST-C'))
    login('care@example.com'); t = main()
    check('C4', '照服員阿妮的住民清單', '看到張榮發（剛開放）與吳月娥（測試案件 D）', '張榮發' in t and '吳月娥' in t, t[:200])
    nav('card', 'TEST-C'); t = main()
    check('C5', '照服員看到正確的摘要卡內容', 'A 區 Aspirin 過敏、增稠；B 區「榮伯」、聽台語老歌，標示家屬提供；看不到身分證字號', 'Aspirin' in t and '榮伯' in t and '台語老歌' in t and '家屬提供' in t and 'F120056789' not in t)
    nav('card', 'TEST-D'); t = main()
    check('D1', '案件 D 預設已開放，照服員直接可看', '吳月娥摘要卡有「月娥阿姨」、客家山歌；沒有「資料已更新」提示', '月娥阿姨' in t and '客家山歌' in t and '資料已更新' not in t and E("cardChanged(D.cases['TEST-D']).length") == 0)
    login('care2@example.com'); t = main()
    check('R1', '未授權的照服員', '黎氏蘭看不到任何測試案件', all(x not in t for x in ['張榮發', '吳月娥', '劉文雄', '林玉蘭']))
    login('family3@example.com'); opts = E("myFamilyCases().map(c => c.patient.name).sort()")
    check('R2', '家屬劉建宏', '看到劉文雄、林玉蘭兩筆（可切換）', opts == sorted(['劉文雄', '林玉蘭']), opts)
    login('family@example.com'); opts = E("myFamilyCases().map(c => c.patient.name).sort()")
    check('R3', '家屬張家豪', '看到張秀英與張榮發', opts == sorted(['張秀英', '張榮發']), opts)
    login('family2@example.com'); opts = E("myFamilyCases().map(c => c.patient.name).sort()")
    check('R4', '家屬陳淑芬', '看到陳金水與吳月娥', opts == sorted(['陳金水', '吳月娥']), opts)
    login('nurse2@example.com'); tk = E("tasks().filter(t => t.c && String(t.c.id).startsWith('TEST-')).length")
    check('R5', '吳護理師（不負責測試案件）', '工作清單沒有測試案件', tk == 0, tk)
    # ===== 重新整理：不自動覆蓋 =====
    S = snap(); S = {k: v for k, v in S.items() if not k.startswith('data/')}; pg2 = page(S)
    pg2.evaluate("go('login', 'staff')"); pg2.wait_for_selector('#loginForm'); pg2.fill('#loginForm [name=email]', 'nurse@example.com'); pg2.fill('#loginForm [name=pw]', 'Test1234'); pg2.click('#loginForm button[type=submit]'); pg2.wait_for_selector('#top [data-act="logout"]', timeout=15000); pg2.wait_for_timeout(800)
    r = pg2.evaluate("[status(D.items['TEST-A_summary'], D.cases['TEST-A']), phase(D.cases['TEST-B']), phase(D.cases['TEST-C'])]")
    check('P1', '重新開啟頁面（以目前資料重新載入）', '測試資料仍在；人工核對與評估結果保留，沒有被自動改回起始狀態', r == ['確認符合', '已收治待簽約', '摘要卡已開放'], r)
    pg2.context.close()
    # ===== 恢復起始狀態 =====
    login('admin@example.com'); before = nontest(snap()); nav('testdata')
    pg.click('[data-act="test-seed"][data-key="A"]'); W(300); body = pg.inner_text('.dialog')
    check('T9', '恢復前顯示影響範圍', '列出案件主檔、文件項目份數、圖片、草稿、辨識結果與通知數量', '文件項目 24 份' in body and '模擬文件圖片' in body and '核對草稿' in body, body[:200])
    pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(1000)
    old_ocr = [k for k in keys('ocrRuns/') if k.startswith('ocrRuns/TEST-A')]
    check('T10', '恢復案件 A 的起始狀態', '出院摘要回到「待護理核對」、欄位空白；舊的辨識結果刪除；仍只有 4 筆測試案件', st('TEST-A_summary') == '待護理核對' and not store('items/TEST-A_summary')['versions'][0].get('fields') and not old_ocr and len(keys('cases/TEST-')) == 4, (st('TEST-A_summary'), old_ocr))
    check('T11', '恢復只影響該筆測試案件', '其他測試案件（B 已收治、C 已開放）與非測試案件都不變', ph('TEST-B') == '已收治待簽約' and ph('TEST-C') == '摘要卡已開放' and nontest(snap()) == before)
    files_now = [k for k in keys('files/') if (store(k) or {}).get('caseId') == 'TEST-A']
    check('T12', '重複恢復不累積舊圖片', '案件 A 的模擬圖片數量與第一次建立相同（舊圖片已刪除）', len(files_now) == 9, len(files_now))
    # 寫入失敗
    nav('testdata'); pg.click('[data-act="test-seed"][data-key="B"]'); W(300)
    E("(() => { const s = window.__store, orig = s.set.bind(s); let n = 0; s.set = (k, v) => { if (k.startsWith('items/TEST-B') && ++n > 3) throw {code:'unavailable'}; return orig(k, v); }; window.__restoreSet = () => { s.set = orig; }; })()")
    pg.click('[data-act="modal-ok"]'); pg.wait_for_function("document.getElementById('merr') && /未完成/.test(document.getElementById('merr').textContent)", timeout=60000); W(300)
    msg = pg.inner_text('#merr'); E("window.__restoreSet()")
    check('T13', '初始化中途寫入失敗', '顯示「未完成」與失敗的文件項目名稱，不顯示成功；案件主檔沒有被寫成新的起始狀態', '未完成' in msg and '文件項目' in msg and ph('TEST-B') != '評估中', msg[:150])
    pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=60000); W(1000)
    check('T14', '失敗後再按一次', '案件 B 恢復為「評估中」', ph('TEST-B') == '評估中', ph('TEST-B'))
    login('staff@example.com'); E("me = D.accounts['staff@example.com']")
    check('T15', '非管理員不能建立測試資料', '行政沒有「測試資料」選單；直接呼叫按鈕動作會被拒絕', 'testdata' not in E("NAV.staff.map(x => x[0]).join()") and (E("ACT['test-seed']({dataset:{key:'A'}}), document.getElementById('toasts').innerText") or '').find('只有系統管理員') >= 0)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_t.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
