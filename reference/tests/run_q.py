"""行政「要求補件」不能繞過護理對管路、傷口、吞嚥的需求判斷。"""
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
    notices = lambda: [store(k) for k in E("[...window.__store.keys()].filter(k => k.startsWith('notices/'))")]
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
    def judge(key, val, note):
        nav('resident', A); pg.click(f'[data-act="need-edit"][data-item="{I(key)}"]'); W(200); pg.check(f'input[name=needSel][value="{val}"]'); pg.fill('#needNote', note); pg.click('[data-act="modal-ok"]'); W(900)
    def request(keys, note, force=False):
        nav('case', A); pg.click('main [data-act="staff-request"]'); W(300)
        for k in keys:
            if force: E(f"(() => {{ const x = document.querySelector('input[name=srItem][value=\"{I(k)}\"]'); x.disabled = false; x.checked = true; }})()")
            else: pg.check(f'input[name=srItem][value="{I(k)}"]')
        pg.fill('#srNote', note); clr(); pg.click('[data-act="modal-ok"]'); W(1200)
        return pg.inner_text('#merr') if pg.query_selector('#merr') else ''
    snapItem = lambda k: {x: store('items/' + I(k)).get(x) for x in ['need', 'condMet', 'req', 'needHist', 'needSetBy', 'required', 'returned']}
    nk = lambda: len([n for n in notices() if n['caseId'] == A])
    # 準備
    login('staff@example.com'); nav('apply', A); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500); assign(A, 'nurse@example.com')
    login('family@example.com'); nav('consent', A); pg.check('input[name=signer][value="本人"]'); pg.check('[name=agree]'); pg.fill('#consentForm [name=signerName]', '測試簽署人'); pg.click('#consentForm button[type=submit]'); W(1500)
    login('nurse@example.com'); judge('woundCare', 'no', '家屬表示沒有傷口')
    check('Q0', '補件功能不再把這三項轉成必備（靜態檢查）', '要求補件寫入時檢查「護理判斷項目且不需要繳交」就拒絕', "if (nurseCond(x) && !isNeeded(x)) return `「${itemName(x)}」是否需要由負責護理師判斷" in HTML)
    # 行政：待確認、不需要都不能勾
    login('staff@example.com'); nav('case', A); pg.click('main [data-act="staff-request"]'); W(300)
    dis = E("Object.fromEntries([...document.querySelectorAll('input[name=srItem]')].map(x => [x.value.split('_').pop(), x.disabled]))")
    txt = pg.inner_text('.dialog')
    check('Q1', '要求補件視窗', '管路、吞嚥（待護理確認）與傷口（護理判定不需要）都列出但不能勾選，說明要請護理重新判斷；診斷證明等其他文件可勾選', dis.get('tubeCare') is True and dis.get('swallow') is True and dis.get('woundCare') is True and dis.get('diag') is False and '請護理重新判斷' in txt, dis)
    pg.click('[data-act="modal-cancel"]'); W(200)
    before = {k: snapItem(k) for k in ['tubeCare', 'woundCare', 'swallow', 'diag']}; n0 = nk()
    e = request(['tubeCare'], '請補管路資料', force=True)
    check('Q2', '行政強制勾選「待護理確認」的管路並送出', '被拒絕並說明由護理判斷；需求判斷、補件請求、通知都沒有改變', '由負責護理師判斷' in e and snapItem('tubeCare') == before['tubeCare'] and nk() == n0 and E(f"condPending(D.items['{I('tubeCare')}'])"), e)
    pg.click('[data-act="modal-cancel"]'); W(200)
    e = request(['diag', 'woundCare'], '請補資料', force=True)
    check('Q3', '同時勾選一般文件與「護理判定不需要」的傷口', '整批被拒絕：診斷證明也沒有被改成需要繳交（不會只完成一半）；傷口仍為不需要', '沒有送出任何補件要求' in e and snapItem('diag') == before['diag'] and snapItem('woundCare') == before['woundCare'] and nk() == n0, e)
    pg.click('[data-act="modal-cancel"]'); W(200)
    # 一般文件的補件照舊
    e = request(['diag'], '請補診斷證明')
    d = store('items/' + I('diag'))
    check('Q5', '其他文件的補件功能不變', '選填的診斷證明改為需要繳交、補件請求開啟、家屬收到通知', d['need'] == '必備' and bool(d.get('req')) and nk() == n0 + 1, e)
    # 請護理重新判斷
    nav('case', A)
    check('Q6', '行政案件頁的「請護理重新判斷」', '管路、傷口、吞嚥各有按鈕', len(pg.query_selector_all('main [data-act="need-ask"]')) == 3)
    pg.click(f'[data-act="need-ask"][data-item="{I("woundCare")}"]'); W(200); pg.click('[data-act="modal-ok"]'); W(300)
    check('Q7', '請求必須寫原因', '擋下', '原因' in pg.inner_text('#merr'));
    pg.fill('#askNote', '家屬來電說長輩薦骨有壓傷'); pg.click('[data-act="modal-ok"]'); W(1000)
    w = store('items/' + I('woundCare'))
    check('Q8', '送出重新判斷請求', '只記錄請求，需求判斷仍是「護理已確認：不需要」；案件頁顯示「已請護理重新判斷」', w['condMet'] is False and w['needAsk']['note'] == '家屬來電說長輩薦骨有壓傷' and '已請護理重新判斷' in main(), w.get('needAsk'))
    # 寫入失敗
    pg.click(f'[data-act="need-ask"][data-item="{I("tubeCare")}"]'); W(200); pg.fill('#askNote', '測試失敗'); E("window.__failWrite = 'items/'"); clr(); pg.click('[data-act="modal-ok"]'); W(1200); E("window.__failWrite = null")
    check('Q9', '請求寫入失敗', '視窗顯示失敗、沒有「已請護理重新判斷」、管路沒有請求紀錄', bool(pg.inner_text('#merr')) and '已請護理' not in pg.inner_text('#toasts') and not store('items/' + I('tubeCare')).get('needAsk'), pg.inner_text('#merr'))
    pg.click('[data-act="modal-cancel"]'); W(200)
    # 護理
    login('nurse@example.com')
    tk = E(f"tasks().filter(t => t.c && t.c.id === '{A}').map(t => t.what)")
    nav('resident', A); card = pg.inner_text('#needCard')
    check('Q10', '護理看到行政的請求', '工作清單「行政請您重新判斷：張秀英｜傷口評估與照護紀錄」；照護文件需求確認卡片顯示請求內容', '行政請您重新判斷：張秀英｜傷口評估與照護紀錄' in tk and '家屬來電說長輩薦骨有壓傷' in card, tk)
    judge('woundCare', 'yes', '依家屬來電，薦骨有壓傷，需要傷口照護資料')
    w = store('items/' + I('woundCare'))
    check('Q11', '護理改判需要，請求結束', '傷口「護理已確認：需要」；請求標示已處理；歷程保留原判斷（不需要 → 需要）', w['condMet'] is True and bool(w['needAsk'].get('doneAt')) and [h['to'] for h in w['needHist']] == ['護理已確認：不需要', '護理已確認：需要'] and not any('重新判斷' in x for x in E(f"tasks().filter(t => t.c && t.c.id === '{A}').map(t => t.what)")), w.get('needHist'))
    judge('tubeCare', 'yes', '出院摘要記載鼻胃管')
    # 行政：護理判定需要後可正常要求補件
    login('staff@example.com')
    stt = E(f"tasks().filter(t => t.c && t.c.id === '{A}' && t.tag === '通知').map(t => t.what)")
    q12 = [store('items/' + I(k)).get('req') or {} for k in ['tubeCare', 'woundCare']]
    check('Q12', '護理判定需要後系統自動建立補件（客戶回饋後）', '管路與傷口都已有系統自動建立的補件要求，行政工作清單沒有「護理判定需要」提醒', stt == [] and all(r.get('auto') is True for r in q12), (stt, q12))
    n1 = nk(); e = request(['tubeCare', 'woundCare'], '護理師確認需要，請提供醫院護理指導單')
    t1, w1 = store('items/' + I('tubeCare')), store('items/' + I('woundCare'))
    check('Q13', '護理判定需要後，行政正常要求補件', '兩份都開啟補件請求；需求仍是護理的判斷（條件式、需要），沒有被改成必備；家屬收到通知；提醒消失', t1['need'] == '條件式必備' and t1['condMet'] is True and bool(t1['req']) and w1['need'] == '條件式必備' and bool(w1['req']) and nk() == n1 + 1 and not E(f"tasks().filter(t => t.c && t.c.id === '{A}' && t.tag === '通知').length"), (t1['need'], e))
    # 家屬同步
    login('family@example.com'); to_guide(); E("document.querySelectorAll('#docList details').forEach(d => d.open = true)")
    rows = E("Object.fromEntries([...document.querySelectorAll('#docList .drow')].map(r => [r.querySelector('.t-name').textContent, r.textContent]))")
    todo = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.key)")
    check('Q14', '家屬畫面同步', '管路、傷口「本案需要繳交」並列入待辦；吞嚥仍「待護理確認」不列待辦；診斷證明列入待辦', '本案需要繳交' in rows['管路照護資料'] and '本案需要繳交' in rows['傷口照護資料'] and '待護理確認' in rows['吞嚥與飲食資料'] and set(['tubeCare', 'woundCare', 'diag']) <= set(todo) and 'swallow' not in todo, todo)
    nav('upload', A, I('woundCare')); pg.set_input_files('#file', {'name': 'w.png', 'mimeType': 'image/png', 'buffer': IMG('06_管路照護指導_張秀英')}); pg.click('#uploadForm button[type=submit]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    login('staff@example.com'); nav('followup'); t = main()
    check('Q15', '補傳後的追蹤', '傷口照護資料有第 1 版、狀態「待收件」，補件請求仍開啟（補傳不等於完成）；補件追蹤列出', E(f"status(D.items['{I('woundCare')}'], D.cases['{A}'])") == '待收件' and not store('items/' + I('woundCare'))['req'].get('closedAt') and '傷口評估與照護紀錄' in t)
    # 收治評估「需要補充」選到待確認的吞嚥：算護理判定需要
    login('nurse@example.com')
    r = E(f"""(async () => {{ const id = '{I('swallow')}'; const req = {{reason:'護理師需要補充資料', note:'需吞嚥評估', due:'2026-12-01', at:stamp(), source:'護理'}};
      const r = await mutateItem(id, null, x => {{ setReq(x, req); if (nurseCond(x) && !isNeeded(x)){{ const from = needText(x); x.condMet = true; x.needSetBy = me.id; x.needSetAt = stamp(); x.needNote = '收治評估要求補充：需吞嚥評估'; x.needRole = 'nurse'; x.needHist = (x.needHist || []).concat([{{from, to:needText(x), at:x.needSetAt, by:me.id, role:'nurse', note:x.needNote}}]); }} }}); return r.ok; }})()""")
    check('Q16', '收治評估「需要補充」選到待確認的吞嚥（靜態檢查＋在瀏覽器執行相同的程式片段，未經完整評估畫面）', '評估程式含此處理；執行後吞嚥變成「護理已確認：需要」並留下歷程', r is True and store('items/' + I('swallow'))['needHist'][-1]['to'] == '護理已確認：需要' and "x.needNote = '收治評估要求補充：' + reason" in HTML)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_q.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
