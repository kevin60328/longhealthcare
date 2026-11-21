"""客戶回饋整合修改：附件十七 A～F 的測試（實際操作畫面＋本機模擬資料庫）。"""
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
        E(f"go('login', '{portal}')"); pg.fill('#loginForm [name=email]', e); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); pg.wait_for_selector('#top [data-act="logout"]', timeout=15000); W(400); pg.evaluate("me && me.role === 'family' && myFamilyCases().length && go('home', myFamilyCases()[0].id)"); pg.wait_for_timeout(200)
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

    # ================= A 帳號與入住申請 =================
    register('newfam@example.com', '王大明', '0955-123-456')
    check('A1', '註冊成功後不會直接進入入住申請', '進入個人首頁，沒有建立任何案件', E("route.page") == 'home' and pg.query_selector('#personalHome') is not None and pg.query_selector('#applyForm') is None and ncases() == 2, (E("route.page"), ncases()))
    t = main()
    check('A2', '沒有案件仍能正常使用個人首頁', '顯示「目前尚無入住申請」與三個入口；我的申請紀錄也顯示尚無申請', '目前尚無入住申請' in t and all(x in t for x in ['我要申請入住', '我的申請紀錄', '申請流程說明']) and ('目前尚無入住申請' in (nav('mycases') or main())) and ('申請流程說明' in (nav('guide') or main())))
    nav('home'); pg.click('#applyMain [data-act="want-apply"]'); W(300)
    check('A3', '可點選「我要申請入住」', '開啟入住申請表，欄位為「預計入住者姓名」，申請人顯示目前帳號', pg.query_selector('#applyForm') is not None and '預計入住者姓名' in main() and '長輩姓名' not in main() and '王大明' in main())
    n0 = ncases(); fill_apply('王小明', 'A123456789', '1940-01-02', '兒子', '2026-12-20', '康寧示範醫院（虛構）')
    t = main()
    check('A4a', '送出前預覽', '顯示申請人、預計入住者、關係、出生日期、醫院、預計入住日期；尚未建立案件；提示確認送出後才記錄申請時間', pg.query_selector('#applyPreview') is not None and all(x in t for x in ['王大明', '王小明', '兒子', '1940/01/02', '康寧示範醫院（虛構）', '2026/12/20', '確認送出後，系統才會記錄正式申請時間']) and ncases() == n0, t[:300])
    pg.click('[data-act="apply-edit"]'); W(300)
    check('A4b', '預覽可返回修改並保留原本輸入', '回到申請表，姓名、身分證、日期、醫院都保留', E("document.querySelector('#applyForm [name=pname]').value") == '王小明' and E("document.querySelector('#applyForm [name=nid]').value") == 'A123456789' and E("document.querySelector('#applyForm [name=hospital]').value") == '康寧示範醫院（虛構）' and E("document.querySelector('#applyForm [name=admit]').value") == '2026-12-20')
    pg.fill('#applyForm [name=admit]', '2026-12-22'); pg.click('#applyForm button[type=submit]'); W(400)
    # 儲存失敗：不顯示成功，保留內容
    E("window.__failWrite = 'cases/'"); pg.click('#applyPreviewForm button[type=submit]'); W(1500)
    check('A10', '儲存失敗不顯示成功', '停在預覽頁並顯示送出失敗；沒有建立案件；資料仍在畫面上', pg.query_selector('#applyPreview') is not None and '送出失敗' in main() and '王小明' in main() and ncases() == n0 and pg.query_selector('#appliedPage') is None, main()[:200])
    E("window.__failWrite = null"); E("window.__d = JSON.parse(JSON.stringify(applyDraft))")
    # 連續點擊兩次
    E("(() => { const b = document.querySelector('#applyPreviewForm button[type=submit]'); b.click(); b.click(); })()"); W(3000)
    cid = E("route.arg"); c1 = store('cases/' + cid)
    check('A9a', '重複點擊不會建立兩筆案件', '連續按兩次「確認送出」只建立 1 筆案件', ncases() == n0 + 1 and c1 and c1['patient']['name'] == '王小明', ncases())
    # 網路重試：用同一份申請資料再送一次
    E("applyDraft = window.__d; route.page = 'applyPreview'; render(true)"); W(300); pg.click('#applyPreviewForm button[type=submit]'); W(2000)
    check('A9b', '網路重試不會建立兩筆案件', '同一份申請重送時找到原本的案件，案件數不變', ncases() == n0 + 1 and E("route.arg") == cid, (ncases(), E("route.arg")))
    t = main()
    check('A6', '申請成功頁', '顯示「入住申請已成功送出」、案件編號、申請人、預計入住者、送出日期與時間、狀態「待行政確認」、下一步與兩個按鈕', pg.query_selector('#appliedPage') is not None and all(x in t for x in ['入住申請已成功送出', c1['no'], '王大明', '王小明', c1['createdAt'][:10], c1['createdAt'][11:16], '待行政確認', '查看申請進度', '返回個人首頁', '下一步']) and c1['docList']['status'] == '完成', t[:300])
    m1 = store('mailQueue/apply_' + cid)
    check('B1', '未介接 Email 時有明確提示', '建立申請確認通知任務，狀態寫明未寄出（測試環境尚未介接），內容沒有身分證字號；畫面說明不會實際寄出', m1 and '尚未介接' in m1['status'] and not m1['acceptedAt'] and not m1['deliveredAt'] and 'A123456789' not in json.dumps(m1, ensure_ascii=False) and '信件不會實際寄出' in t, m1)
    acc = store('accounts/newfam@example.com')
    nav('home'); t = main()
    check('B2', '不會顯示假的信箱驗證成功', '帳號驗證狀態為「測試環境尚未介接」，畫面沒有「已驗證」「已寄出」的成功訊息', acc['emailVerify']['state'] == '測試環境尚未介接' and 'Email：測試環境尚未介接' in t and '已寄出' not in t.replace('不會顯示「已寄出」', '') and 'Email：已驗證' not in t, (acc.get('emailVerify'), t[:200]))
    nav('home', cid); pg.click(f'[data-act="mail-resend"][data-case="{cid}"]'); W(800); a0 = len(store('mailQueue/apply_' + cid)['attempts'])
    E(f"(() => {{ const m = window.__store.get('mailQueue/apply_{cid}'); m.attempts.forEach(x => x.ts -= 120000); }})()")
    pg.click(f'[data-act="mail-resend"][data-case="{cid}"]'); W(800); pg.click(f'[data-act="mail-resend"][data-case="{cid}"]'); W(800)
    m2 = store('mailQueue/apply_' + cid)
    check('B5b', '重新寄送不重建案件、不重複寄送', '剛建立任務一分鐘內按重新寄送不會重複；一分鐘後重新寄送只在同一個通知任務加一筆嘗試，連按兩次也只加一筆；案件數不變', a0 == 1 and len(m2['attempts']) == 2 and ncases() == n0 + 1, (a0, len(m2['attempts'])))
    # 郵件通知任務失敗不刪除案件
    nav('apply'); fill_apply('王小華', 'A223456781', '1942-03-04', '女兒', '2026-12-28')
    E("window.__failWrite = 'mailQueue/'"); pg.click('#applyPreviewForm button[type=submit]'); W(3000); E("window.__failWrite = null")
    cid2 = E("route.arg")
    check('B5', '郵件通知失敗不會刪除案件', '通知任務寫入失敗時案件仍建立並顯示成功頁，提示可重新建立通知任務', ncases() == n0 + 2 and store('cases/' + cid2) and pg.query_selector('[data-act="mail-retry"]') is not None and not store('mailQueue/apply_' + cid2), (ncases(), cid2))
    pg.click('[data-act="mail-retry"]'); W(800)
    check('B5c', '重新建立通知任務', '按「重新建立通知任務」後建立一筆任務', bool(store('mailQueue/apply_' + cid2)))
    nav('mycases'); t = main()
    check('A7', '已有案件可查看申請紀錄', '我的申請紀錄列出兩筆申請、送出時間與狀態', '王小明' in t and '王小華' in t and t.count('待行政確認') >= 2)
    check('A8', '同一人可以提出多筆不同案件', '同一帳號有 2 筆案件', len([k for k in keys('cases/') if store(k)['familyId'] == 'newfam@example.com']) == 2)
    created = store('cases/' + cid)['createdAt']
    # 入口與帳號分離
    logout(); E("go('login', 'applicant')"); pg.fill('#loginForm [name=email]', 'staff@example.com'); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); W(800)
    e1 = pg.inner_text('#loginErr')
    E("go('login', 'staff')"); pg.fill('#loginForm [name=email]', 'family@example.com'); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); W(800)
    e2 = pg.inner_text('#loginErr')
    check('A11', '員工工作權限不會自動帶入一般申請流程', '工作帳號從一般申請人入口登入被擋下並說明需另外註冊；申請人帳號從員工入口登入也被擋下', '機構工作人員帳號' in e1 and '另外註冊' in e1 and '一般申請人帳號' in e2 and not pg.query_selector('#top [data-act="logout"]'), (e1, e2))
    login('staff@example.com'); E("ACT['want-apply']()"); W(300)
    check('A12', '一般申請人與員工入口正常', '員工從員工入口登入後進入工作清單；工作帳號按「我要申請入住」不會開啟申請表', '今天要處理的事' in main() and pg.query_selector('#applyForm') is None)
    # 利益衝突：申請人電話與行政相同
    register('kid@example.com', '陳家人', '0911-000-002'); nav('apply'); fill_apply('陳老先生', 'B123456780', '1938-08-08', '其他親屬', '2026-12-30'); pg.click('#applyPreviewForm button[type=submit]'); W(2500)
    cid3 = E("route.arg")
    login('staff@example.com'); nav('apply', cid3); t = main(); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(1200)
    check('A13', '機構人員不能確認自己（或同電話）提出的申請', '申請確認頁提示請由其他同仁處理；送出被擋下，案件仍待確認', '請由其他同仁處理' in t and store('cases/' + cid3)['linkStatus'] == '待確認', store('cases/' + cid3)['linkStatus'])

    # ================= C 護理案件分配 =================
    nav('apply', A); t = main()
    check('C1a', '行政無法直接指派護理師（申請確認頁）', '沒有護理師選單，按鈕為「確認申請並轉交護理部門」', pg.query_selector('#applyConfirm [name=nurse]') is None and '確認申請並轉交護理部門' in t)
    pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500)
    nav('apply', B); pg.check('[name=called]'); pg.click('#applyConfirm button[type=submit]'); W(2500)
    ca = store('cases/' + A)
    check('C2', '行政可將案件轉交護理部門', '案件已確認、記錄轉交時間，承辦護理師空白，分配狀態「待分配」', ca['linkStatus'] == '已確認' and ca.get('handoverAt') and ca['nurseId'] == '' and E(f"assignState(D.cases['{A}'])") == '待分配', ca)
    nav('case', A); t = main()
    E(f"ACT['assign-nurse']({{dataset:{{case:'{A}'}}}})"); W(300)
    check('C1b', '行政無法直接指派護理師（案件頁與直接呼叫）', '案件頁沒有護理師下拉選單，只顯示「待分配」與說明；直接呼叫分配動作被擋下', pg.query_selector('#nurseSel') is None and '由具案件分配權限的護理人員安排' in t and not pg.query_selector('#asNurse') and store('cases/' + A)['nurseId'] == '')
    # 待分配期間：家屬授權、上傳；行政收件
    login('family@example.com'); consent(A); upload(A, 'idcopy', '01_身分證影本_張秀英')
    login('staff@example.com'); receipt(A, 'idcopy', '民國 29 年 6 月 12 日')
    check('C8', '待分配期間家屬仍能授權及上傳', '尚未分配護理師時，家屬完成授權與上傳，行政完成收件', store('cases/' + A)['consent'] and st('idcopy') == '確認符合' and store('cases/' + A)['nurseId'] == '', st('idcopy'))
    # 一般護理師
    login('nurse2@example.com'); navs = E("[...document.querySelectorAll('.subnav button')].map(b => b.dataset.page)")
    nav('assign'); t2 = main()
    E("me.canAssignNurse = true"); nav('assign'); pg.click(f'[data-act="assign-nurse"][data-case="{A}"]'); W(200); pg.select_option('#asNurse', 'nurse2@example.com'); pg.click('[data-act="modal-ok"]'); W(1200)
    merr = pg.inner_text('#merr'); E("closeModal()")
    check('C4', '一般護理師不能任意指派', '沒有「案件分配」選單、頁面顯示沒有權限；即使在畫面上竄改權限，寫入前重新讀取帳號仍擋下', 'assign' not in navs and '沒有案件分配權限' in t2 and '沒有案件分配權限' in merr and store('cases/' + A)['nurseId'] == '', (navs, merr))
    login('nurse@example.com'); nav('assign'); t = main()
    check('C3', '待分配案件出現在護理端', '具分配權限的護理人員看到兩筆待分配案件（編號、預計入住者、申請日期、預計入住日期、案件狀態、分配狀態）', '張秀英' in pg.inner_text('#assignWait') and '陳金水' in pg.inner_text('#assignWait') and 'C-0001' in t and '待分配' in t)
    assign_ui(A, 'nurse2@example.com'); assign_ui(B, 'nurse2@example.com')
    check('C5a', '授權護理人員可以指派', '兩案承辦改為吳護理師，分配歷程記錄指派人與時間', store('cases/' + A)['nurseId'] == 'nurse2@example.com' and store('cases/' + B)['nurseId'] == 'nurse2@example.com' and store('cases/' + A)['assignHist'][0]['by'] == 'nurse@example.com')
    # D 文件需求：護理判定需要 → 自動通知
    login('nurse2@example.com')
    nk = lambda c=A: len([k for k in keys('notices/') if store(k)['caseId'] == c])
    n_before = nk(); judge(A, 'tubeCare', 'yes', '出院摘要記載鼻胃管，管徑 16Fr')
    tr = store('items/' + I('tubeCare')).get('req') or {}
    ns = [store(k)['text'] for k in keys('notices/') if store(k)['caseId'] == A]
    check('D5', '護理判定需要後，自動建立適當通知', '自動建立補件要求（來源護理）；家屬收到 1 則通知，使用家屬名稱「管路照護資料」並有期限，不含判斷依據的醫療細節', tr.get('auto') is True and tr.get('source') == '護理' and nk() == n_before + 1 and any('管路照護資料' in x and '16Fr' not in x and '前上傳' in x for x in ns), (tr, ns[-1:]))
    judge(A, 'tubeCare', 'yes', '再次確認：出院摘要記載鼻胃管'); E(f"syncNurseNeedReq(D.items['{I('tubeCare')}'])"); W(800)
    t2r = store('items/' + I('tubeCare'))
    check('D6', '同一需求不會重複發送補件請求', '重新儲存同一判斷、再次執行自動通知，都沒有新增補件要求或通知', not t2r.get('reqHistory') and nk() == n_before + 1, (t2r.get('reqHistory'), nk()))
    judge(A, 'woundCare', 'yes', '家屬表示薦骨有壓傷'); n_w = nk(); judge(A, 'woundCare', 'no', '入院前已癒合，家屬照片確認')
    wr = store('items/' + I('woundCare')).get('req') or {}
    check('D8', '判定不需要時，不再錯誤要求家屬補件', '改判不需要後，原本自動建立的補件要求關閉；不再列入家屬待辦；家屬收到不用再上傳的通知', wr.get('closedAt') and '不需要' in wr.get('closedReason', '') and not E(f"familyTodo(D.items['{I('woundCare')}'], D.cases['{A}'])") and nk() == n_w + 1, wr)
    judge(A, 'swallow', 'no', '可由口進食')
    # 重新分配
    snap = {k: store(k) for k in keys('items/' + A)}
    login('nurse@example.com'); assign_ui(A, 'nurse@example.com', '吳護理師請假，改由黃護理師接手')
    ca = store('cases/' + A)
    check('C5b', '授權護理人員可以重新分配', '承辦改為黃護理師；分配歷程 2 筆，第二筆記錄原承辦、新承辦、調整人員、時間與原因', ca['nurseId'] == 'nurse@example.com' and len(ca['assignHist']) == 2 and ca['assignHist'][1]['from'] == 'nurse2@example.com' and bool(ca['assignHist'][1]['reason'] and ca['assignHist'][1]['at']), ca.get('assignHist'))
    after = {k: store(k) for k in keys('items/' + A)}
    check('C7', '重新分配不會遺失原始文件與核對歷程', '所有文件項目（版本、需求判斷歷程、補件要求）在重新分配前後完全相同', after == snap)
    login('nurse2@example.com'); g = E(f"assessGuard(D.cases['{A}'])"); tk = E(f"tasks().filter(t => t.c && t.c.id === '{A}').length")
    nav('resident', A); still = '負責住民' in main() and pg.query_selector('#needCard') is None
    check('C6', '舊承辦者不能繼續修改', '原承辦工作清單沒有此案件、不能開啟住民資料、評估前置條件拒絕', tk == 0 and still and '只有負責護理師' in str(g), (tk, still, g))
    check('E2', '護理不會看到未授權的其他案件', '非承辦護理師開啟住民資料與文件頁都被擋下', still and '不是這位住民的負責護理師' in (nav('doc', I('idcopy')) or main()))

    # ================= 先審後簽完整流程（張秀英） =================
    login('family@example.com')
    for k, img in [('nhi', '02_健保卡_張秀英'), ('summary', '03_出院病歷摘要_張秀英'), ('meds', '04_用藥清單_張秀英'), ('tubeCare', '06_管路照護指導_張秀英')]: upload(A, k, img)
    nav('home', A); t = main()
    later = E(f"activeItems(D.cases['{A}']).filter(i => i.stage === '入住前').length"); todo = E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.stage)")
    grp_later = pg.text_content('#grpLater') if pg.query_selector('#grpLater') else ''
    check('D1', '當前待辦不會混入尚未開放的文件', '簽約前，目前要處理與正在審核的文件都是評估前文件；入住前健康檢查不在待辦、不算逾期', later == 0 and all(x == '評估前' for x in todo) and '入住前健康檢查報告' not in (pg.inner_text('#grpWait') if pg.query_selector('#grpWait') else '') and not E(f"followupRows().some(r => r.c.id === '{A}' && r.i.stage === '入住前')"), (later, todo))
    check('D2', '可以預覽後續階段準備項目', '「下一階段預告」列出入住前健康檢查報告等，標示簽約後再準備；完整清單移到「申請流程說明」（首頁有連結）', '入住前健康檢查報告' in grp_later and '簽約後再準備' in grp_later and pg.query_selector('#fullListLink') is not None)
    check('D3', '七大類文件仍完整保留', '24 份內建文件項目都在，完整清單有 A～F 類', len([k for k in keys('items/' + A + '_')]) >= 24 and all(f'{x}. ' in (to_guide() or pg.text_content('#fullDocList')) for x in 'ABCDEF'))
    nav('home', A); check('F5a', '上傳完成等待審核', '已上傳的文件顯示「已上傳，等待機構審核」，不是未上傳', '已上傳，等待機構審核' in pg.inner_text('#grpWait'))
    check('D9', '契約及費用文件不會變成家屬必傳項目', '家屬待辦沒有契約、收費明細、收據、保證金', not set(E(f"activeItems(D.cases['{A}']).filter(i => familyTodo(i, D.cases['{A}'])).map(i => i.key)")) & {'contract', 'fee', 'payReceipt', 'deposit'})
    # 習慣卡（授權後即可填）
    nav('life', A, '4'); pg.fill('#habitForm [name=famAllergy]', '海鮮') if pg.query_selector('#habitForm [name=famAllergy]') else None
    if not pg.query_selector('#habitForm [name=famAllergy]'):
        for n in range(7):
            nav('life', A, str(n))
            if pg.query_selector('#habitForm [name=famAllergy]'): break
    pg.fill('#habitForm [name=famAllergy]', '海鮮'); pg.click('#habitForm button[value="stay"]'); W(1000)
    E(f"window.__autoHabitSkip = ['{A}']"); hab_submit(A)
    login('staff@example.com')
    for k in ['nhi', 'summary', 'meds', 'tubeCare']: receipt(A, k, '1940/06/12')
    tro = store('items/' + I('tubeCare'))['req']
    check('D7a', '家屬補傳後仍須行政確認', '補傳後補件要求仍開啟（記錄補傳時間）；行政收件後轉給護理核對，仍未關閉', tro.get('uploadedAt') and not tro.get('closedAt') and st('tubeCare') == '待護理核對', (tro, st('tubeCare')))
    login('nurse@example.com')
    g0 = E(f"assessGuard(D.cases['{A}'])")
    nav('assess', A)
    check('E7', '護理收治評估仍需符合前置條件', '醫療文件尚未核對時，評估前置條件拒絕、評估頁顯示目前不能評估', g0 is not True and '目前不能評估' in main(), g0)
    nav('resident', A); t = main()
    check('E1', '個案總覽顯示正確案件資料', '個案總覽有案件資訊（編號、申請人、流程、護理分配）、進度、診斷、照護需求、文件、習慣卡、處理歷程', all(x in t for x in ['案件資訊', 'C-0001', '張家豪', '先審後簽', '已分配', '進度', '診斷清單', '照護文件需求確認', '健康檢查、醫療與照護文件', '家屬提供之生活資訊', '處理歷程']))
    check('E3a', '生活習慣卡可於初審階段查看', '收治評估前，護理已能看到家屬填的習慣卡（家屬所知過敏「海鮮」），初審狀態「待審核」', '海鮮' in t and '待審核' in pg.inner_text('#habitReview'))
    pg.fill('#hrNote', '家屬寫海鮮過敏，病摘未記載，需再確認'); pg.click(f'[data-act="habit-review"][data-case="{A}"][data-state="有疑義"]'); W(1000)
    nav('review', I('summary'))
    for i, q in {0: '住院出院摘要', 5: '無'}.items(): pg.click(f'[data-act="f-quick"][data-i="{i}"][data-q="{q}"]'); W(150)
    for i, v in {1: '腦中風後遺症、高血壓', 2: '2026-11-04', 3: '鼻胃管', 4: '磺胺類藥物（皮疹）'}.items(): pg.fill(f'#fv-{i}', v)
    pg.click('[data-act="dxr-split"]'); W(400); all_ok(); pg.click('[data-act="review-done"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(600)
    review(A, 'meds', quick={1: '文件未記載'}, fill={0: 'Aspirin 100 mg 每日一次'})
    review(A, 'tubeCare', fill={0: '鼻胃管 16Fr，每月更換'})
    tro = store('items/' + I('tubeCare'))['req']
    check('D7b', '護理核對符合後補件才結束', '護理核對完成、文件確認符合後，補件要求才關閉', st('tubeCare') == '確認符合' and bool(tro.get('closedAt')), tro)
    ca = store('cases/' + A)
    check('E4', '家屬資料不覆蓋醫療資料', '已確認的過敏仍是病摘的「磺胺類藥物（皮疹）」；家屬的「海鮮」列為不一致待確認', E(f"confirmedField(D.cases['{A}'], 'allergy')") == '磺胺類藥物（皮疹）' and E(f"cardDiffs(D.cases['{A}']).length") == 1 and ca['habitReview']['state'] == '有疑義')
    check('E5', '初步審核習慣卡不會直接開放照服員', '習慣卡初審後沒有摘要卡，照服員看不到這位住民', not ca.get('card') and not E(f"Object.values(D.cases).some(c => c.id === '{A}' && c.card)"))
    nav('resident', A); pg.click(f'[data-act="dx-import"][data-case="{A}"]'); W(1000)
    dx = store('cases/' + A).get('diagnoses') or []
    check('E6a', 'ICD-10 代碼不會自動產生；逐筆確認的診斷不重複帶入', '病摘逐筆確認的 2 筆診斷已在診斷清單（已確認、代碼空白、來源第 1 版）；再按「從病摘帶入」不會重複新增', len(dx) == 2 and all(d['state'] == '已確認' and not d['icd'] for d in dx) and dx[0]['src']['v'] == 1 and E(f"dxText(D.cases['{A}'])") == '腦中風後遺症、高血壓', dx)
    nav('resident', A); pg.click(f'[data-act="dx-edit"][data-case="{A}"][data-n="1"]'); W(200); pg.fill('#dxStd', '本態性高血壓'); pg.fill('#dxIcd', 'I10X1'); pg.fill('#dxIcdName', 'Essential (primary) hypertension'); pg.check('#dxOk'); pg.click('[data-act="modal-ok"]'); W(600)
    bad_icd = pg.inner_text('#merr'); pg.fill('#dxIcd', 'I10'); pg.click('[data-act="modal-ok"]'); W(1000)
    dx = store('cases/' + A)['diagnoses']
    check('E6b', '診斷人工確認與 ICD-10-CM 格式檢查', '格式錯誤的代碼被擋下；人工確認後該筆「已確認」，記錄確認人與時間；照護摘要只用已確認的診斷', '格式不正確' in bad_icd and dx[1]['state'] == '已確認' and dx[1]['icd'] == 'I10' and dx[1]['by'] == 'nurse@example.com' and E(f"dxText(D.cases['{A}'])") == '腦中風後遺症、本態性高血壓', (bad_icd, dx[1]))
    nav('resident', A); pg.fill('#hrRes-0', '已向家屬確認：海鮮為食物不耐'); pg.fill('#hrNote', '疑義已處理'); pg.click(f'[data-act="habit-review"][data-case="{A}"][data-state="審核完成"]'); W(1200)
    nav('assess', A); btn = pg.inner_text('#assessForm button[type=submit]')
    pg.select_option('#assessForm [name=move]', '一人協助'); pg.check('#assessForm input[name=result][value="收治"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(500)
    check('L1', '評估按鈕文字', '按鈕為「確認收治評估結果」；結果選項保留收治／需補充／待協調／不收治', btn == '確認收治評估結果' and ph() == '已收治待簽約', (btn, ph()))
    login('staff@example.com'); nav('case', A); pg.click('main [data-act="signed"]'); W(300)
    if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
    W(1200)
    nav('case', A); pg.click(f'[data-act="need-edit"][data-item="{I("relProof")}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    nav('case', A); pg.click(f'[data-act="visit-edit"][data-case="{A}"]'); W(200); pg.select_option('#vNeed', '需要'); pg.select_option('#vSt', '已完成'); pg.fill('#vDate', '2026-11-12'); pg.fill('#vTime', '10:00'); pg.select_option('#dApp', '適用'); pg.select_option('#dSt', '待繳納'); pg.click('[data-act="modal-ok"]'); W(1000)
    vc = store('cases/' + A)
    check('K1', '參訪與保證金預留欄位', '記錄參訪需要、預定日期時間、狀態與實際完成時間、保證金適用與狀態；不影響案件狀態', vc['visit']['status'] == '已完成' and vc['visit']['doneAt'] and vc['depositInfo']['status'] == '待繳納' and ph() in ('待補件', '入住前文件審查'), (vc.get('visit'), ph()))
    login('family@example.com')
    upload(A, 'exam', '08_體檢報告_張秀英', '2026-11-05')
    nav('upload', A, I('xray')); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    check('D4', '文件重複沿用正常', '胸部 X 光沿用體檢報告的檔案，保留來源與版本', (store('items/' + I('xray'))['versions'][0].get('fromItem') or {}).get('id') == I('exam'))
    upload(A, 'stool', '09_糞便檢查_張秀英', '2026-11-05'); upload(A, 'signerId', '10_簽約者身分證_張家豪'); upload(A, 'emergency', '12_緊急事故處理同意書_張秀英')
    login('staff@example.com')
    for k in ['exam', 'xray', 'stool']: receipt(A, k, '1940/06/12')
    receipt(A, 'signerId', None, signer='張家豪'); receipt(A, 'emergency', None)
    for k in ['exam', 'xray', 'stool']:
        nav('date', I(k)); pg.fill('#dateVal', '2026-11-05'); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse@example.com'); review_exam(A); review(A, 'xray', fill={0: '心肺無明顯異常'}); review(A, 'stool', fill={0: '陰性'})
    check('E8a', '摘要卡仍須護理確認後開放', '文件齊全後只產生草稿，照服員看不到', E(f"(D.cases['{A}'].card || {{}}).status") == '草稿' and ph() == '摘要卡審核中')
    nav('card', A); pg.check('#cardForm input[name=cg][value="care@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('F1', '先審後簽完整流程可到達摘要卡開放', '沒有上傳契約影本、只有正式簽約紀錄，案件仍到「摘要卡已開放」；摘要卡主要健康問題只含逐筆確認的診斷', ph() == '摘要卡已開放' and len(store('items/' + I('contract'))['versions']) == 0 and store('cases/' + A)['card']['dx'] == '腦中風後遺症、本態性高血壓', (ph(), store('cases/' + A)['card'].get('dx')))
    tl = E(f"caseTimeline(D.cases['{A}']).map(e => e.kind)")
    order = ['apply', 'confirm', 'handover', 'consent', 'assign', 'review', 'assess', 'sign', 'predocs', 'card']
    pos = [tl.index(k) for k in order if k in tl]
    check('B6a', '先審後簽時間軸順序正確', '送出→行政確認→轉交護理→授權（本測試在分配前完成）→分配→護理核對→收治評估→簽約→入住前文件完成→摘要卡開放，依實際時間排列', len(pos) == len(order) and pos == sorted(pos), tl)
    login('care@example.com'); nav('card', A); ctext = main()
    check('E10', '照服員不能修改醫療內容', '照服員的摘要卡頁沒有任何輸入欄位或送出按鈕，也不能開啟護理核對頁', pg.query_selector('main input, main textarea, main form') is None and '只能查看' in ctext and (nav('review', I('summary')) or True) and pg.query_selector('[data-act="review-done"]') is None)
    login('family@example.com'); nav('life', A, '0'); pg.fill('#habitForm [name=call]', '秀英阿嬤'); pg.click('#habitForm button[value="stay"]'); W(1000); pg.click('[data-act="habit-submit"]'); W(1500)
    login('nurse@example.com'); nav('resident', A)
    check('E9', '摘要卡依據變動時仍會提示重新審核', '家屬修改習慣卡後，摘要卡標示待重新審核；習慣卡初審顯示「家屬已更新」，需要護理重新查看', '家屬生活與照護習慣卡' in E(f"cardChanged(D.cases['{A}'])") and '家屬已重新提交' in pg.inner_text('#habitReview'), E(f"cardChanged(D.cases['{A}'])"))

    # ================= 先簽後審完整流程（陳金水） =================
    login('family2@example.com'); consent(B)
    for k, img, d in [('idcopy', '14_身分證影本_陳金水', None), ('nhi', '15_健保卡_陳金水', None), ('summary', '16_近期醫療摘要_陳金水', None), ('meds', '17_用藥清單_陳金水', None), ('exam', '18_體檢報告_陳金水', '2026-11-06'), ('stool', '19_糞便檢查_陳金水', '2026-11-07'), ('signerId', '20_簽約者身分證_陳淑芬', None), ('emergency', '21_緊急事故處理同意書_陳金水', None)]:
        upload(B, k, img, d)
    nav('upload', B, I('xray', B)); pg.click('[data-act="use-exam"]'); pg.wait_for_function("route.page === 'uploaded'", timeout=15000); W(300)
    nav('home', B); grp = pg.inner_text('#docGroups')
    check('F3b', '先簽後審文件清楚分組', '一開始就要求全部文件，但畫面分成「評估前文件」與「入住前文件」', '評估前文件' in grp and '入住前文件' in grp)
    login('nurse2@example.com'); judge(B, 'tubeCare', 'no', '無'); judge(B, 'woundCare', 'no', '無'); judge(B, 'swallow', 'no', '無')
    login('staff@example.com'); nav('case', B); pg.click(f'[data-act="need-edit"][data-item="{I("relProof", B)}"]'); W(200); pg.check('input[name=needSel][value="no"]'); pg.fill('#needNote', '本人簽約'); pg.click('[data-act="modal-ok"]'); W(900)
    for k in ['idcopy', 'nhi', 'summary', 'meds', 'exam', 'xray', 'stool']: receipt(B, k, '1936/09/20')
    receipt(B, 'signerId', None, signer='陳淑芬'); receipt(B, 'emergency', None)
    for k, d in [('exam', '2026-11-06'), ('xray', '2026-11-06'), ('stool', '2026-11-07')]:
        nav('date', I(k, B)); pg.fill('#dateVal', d); pg.click('[data-act="date-confirm"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(300)
    login('nurse2@example.com')
    review(B, 'summary', quick={0: '門診／近期醫療摘要', 5: '文件未記載'}, fill={1: '失智症、糖尿病', 3: '無', 4: '無已知過敏'})
    review(B, 'meds', quick={1: '文件未記載'}, fill={0: 'Metformin 500 mg 每日兩次'}); review_exam(B); review(B, 'xray', fill={0: '心肺無明顯異常'}); review(B, 'stool', fill={0: '陰性'})
    login('staff@example.com'); nav('case', B); pg.click(f'[data-act="inst-up"][data-item="{I("contract", B)}"]'); W(200); pg.set_input_files('#ipFile', {'name': 'c.png', 'mimeType': 'image/png', 'buffer': IMG('22_入住契約_陳金水')}); pg.click('[data-act="modal-ok"]'); W(1500)
    check('F4', '只有契約檔案但未登錄簽約，不能直接完成', '行政上傳契約檔案但沒有記錄簽約：契約「待登錄簽約」、案件「待簽約」，護理不能做入住前確認', st('contract', B) == '待登錄簽約' and ph(B) == '待簽約' and E(f"(me = D.accounts['nurse2@example.com'], assessGuard(D.cases['{B}']))") is not True, (st('contract', B), ph(B)))
    E("me = D.accounts['staff@example.com']"); nav('case', B); pg.click('main [data-act="signed"]'); W(300)
    if pg.query_selector('[data-act="modal-ok"]'): pg.click('[data-act="modal-ok"]')
    W(1200)
    login('nurse2@example.com'); nav('assess', B); btn = pg.inner_text('#assessForm button[type=submit]')
    pg.select_option('#assessForm [name=move]', '可自行移位'); pg.check('#assessForm input[name=result][value="可入住"]'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(500)
    nav('card', B); pg.check('#cardForm input[name=cg][value="care2@example.com"]'); pg.click('#cardForm button[type=submit]'); pg.wait_for_function("route.page === 'home'", timeout=15000); W(800)
    check('F2', '先簽後審完整流程可到達摘要卡開放', '簽約後護理入住前確認「可入住」，摘要卡開放', ph(B) == '摘要卡已開放' and btn == '確認入住前護理確認結果', (ph(B), btn))
    tl = E(f"caseTimeline(D.cases['{B}']).map(e => e.kind)")
    order = ['apply', 'confirm', 'handover', 'assign', 'consent', 'review', 'sign', 'predocs', 'assess', 'card']
    pos = [tl.index(k) for k in order if k in tl]
    check('B6b', '先簽後審時間軸順序正確', '送出→確認→轉交→分配→授權→護理核對→簽約→入住前文件完成→入住前護理確認→摘要卡開放（與先審後簽不同）', len(pos) == len(order) and pos == sorted(pos), tl)
    login('family2@example.com'); nav('home', B); t = main()
    check('B7', '家屬看得到處理歷程', '家屬案件頁有「處理歷程」，含送出、確認、簽約與日期時間', pg.query_selector('#timeline') is not None and '入住申請已送出' in pg.text_content('#timeline') and '正式簽約已記錄' in pg.text_content('#timeline'))

    # ================= 工作清單分頁 =================
    login('staff@example.com'); pg.click('[data-act="work-tab"][data-tab="done"]'); W(400); d1 = (E("document.querySelectorAll('#doneList details').forEach(d => d.open = true)") or pg.inner_text('#doneList'))
    login('nurse@example.com'); pg.click('[data-act="work-tab"][data-tab="done"]'); W(400); d2 = (E("document.querySelectorAll('#doneList details').forEach(d => d.open = true)") or pg.inner_text('#doneList'))
    check('H2', '工作清單有待處理／已完成', '行政的已完成列出確認申請、收件、簽約（含處理人員與時間）；護理的已完成列出核對、評估、摘要卡', '行政已確認' in d1 and '行政收件已確認' in d1 and '正式簽約已記錄' in d1 and '陳社工' in d1 and '護理內容已核對' in d2 and '收治評估結果' in d2 and '照護摘要卡' in d2)

    # ================= 測試案件、例外 =================
    login('admin@example.com'); nav('testdata'); pg.click('[data-act="test-seed-missing"]'); W(300); pg.click('[data-act="modal-ok"]'); pg.wait_for_function("!document.querySelector('.dialog')", timeout=90000); W(1000)
    phs = {k: ph('TEST-' + k) for k in 'ABCD'}
    tlA = E("caseTimeline(D.cases['TEST-A']).filter(e => e.kind === 'assign').map(e => e.note)")
    check('F8', '舊案件及測試案件 A～D 仍可使用', '測試案件 A～D 建立成功，狀態與起始情境相同；沒有分配歷程的舊資料不產生分配時間，只標示「原始分配時間未記錄」', phs['C'] == '摘要卡審核中' and phs['D'] == '摘要卡已開放' and phs['B'] == '評估中' and tlA == [] and '原始分配時間未記錄' in E("legacyAssignNote(D.cases['TEST-A'])"), (phs, tlA))
    login('nurse@example.com'); nav('assess', 'TEST-B'); pg.select_option('#assessForm [name=move]', '一人協助'); pg.check('#assessForm input[name=result][value="待協調"]'); pg.fill('#assessForm [name=reason]', '需要氣墊床'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); W(1500)
    p1 = ph('TEST-B')
    login('staff@example.com'); nav('case', 'TEST-B'); pg.click('[data-act="coord"][data-r="重評"]'); W(200); pg.fill('#coNote', '家屬同意自費氣墊床，請重新評估'); pg.click('[data-act="modal-ok"]'); W(1200)
    login('nurse@example.com'); nav('assess', 'TEST-B'); pg.check('#assessForm input[name=result][value="不收治"]'); pg.fill('#assessForm [name=reason]', '需要 24 小時呼吸照護，超出本中心照護能力'); pg.click('#assessForm button[type=submit]'); W(300); pg.click('[data-act="modal-ok"]'); W(1500)
    check('F5', '不收治與待協調仍能正常處理', '評估「待協調」→ 行政交回重新評估 →「不收治」，案件結案並通知家屬', p1 == '待協調' and ph('TEST-B') == '已結案' and any('完成評估' in (store(k).get('text') or '') for k in keys('notices/') if store(k)['caseId'] == 'TEST-B'), (p1, ph('TEST-B')))
    login('staff@example.com'); E("ACT['visit-edit']({dataset:{case:'TEST-B'}})"); W(300); vb = pg.query_selector('#vNeed') is None
    login('family3@example.com'); nav('upload', 'TEST-B', 'TEST-B_rehab'); ub = pg.query_selector('#uploadForm') is None
    check('F7', '已結案案件不能繼續正常寫入', '已結案的案件：行政不能編輯參訪欄位、家屬不能上傳', vb and ub, (vb, ub))
    nav('home', 'TEST-A'); E("ACT['consent-withdraw']({dataset:{case:'TEST-A'}})"); W(200); pg.fill('#wdPw', 'Test1234'); pg.click('[data-act="modal-ok"]'); W(1500)
    login('nurse@example.com'); nav('review', 'TEST-A_summary'); t = main(); g = E("assessGuard(D.cases['TEST-A'])")
    check('F6', '撤回授權後不能繼續處理醫療資料', '家屬撤回同意後，護理核對頁顯示無法處理、評估前置條件拒絕', '無法處理這份資料' in t and g is not True, g)
    # 寫入失敗：分配
    login('nurse@example.com'); E("window.__failWrite = 'cases/'"); nav('assign'); pg.click(f'[data-act="assign-nurse"][data-case="{B}"]'); W(200); pg.select_option('#asNurse', 'nurse@example.com'); pg.fill('#asReason', '測試寫入失敗'); pg.click('[data-act="modal-ok"]'); W(1500)
    merr = pg.inner_text('#merr'); E("window.__failWrite = null; closeModal()")
    check('F9', '寫入失敗時保留輸入內容，不提前顯示成功', '分配寫入失敗時視窗顯示失敗原因，承辦護理師沒有改變', '失敗' in merr and store('cases/' + B)['nurseId'] == 'nurse2@example.com', merr)
    # 重新讀取、登出登入、切換帳號後的一致性
    before = {k: store(k) for k in keys('cases/')}
    E("D.cases = Object.fromEntries([...window.__store.keys()].filter(k => k.startsWith('cases/')).map(k => [k.slice(6), Object.assign({id:k.slice(6)}, JSON.parse(JSON.stringify(window.__store.get(k))))]))")
    login('newfam@example.com'); nav('mycases'); t = main(); login('family@example.com'); login('newfam@example.com')
    after = {k: store(k) for k in keys('cases/')}
    check('R1', '重新讀取、登出登入與切換帳號後資料一致', '案件資料（含送出時間、承辦護理師、分配歷程）不變；申請紀錄顯示原本的送出時間', before == after and created in t and store('cases/' + cid)['createdAt'] == created, created)
    check('Z1', '過程中沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(results, open('/home/claude/simp/run_f.json', 'w'), ensure_ascii=False, indent=1)
print('TOTAL', len(results), 'PASS', sum(r['result'] == 'PASS' for r in results))
