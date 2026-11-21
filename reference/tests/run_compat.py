"""舊格式資料相容：用上一版建立測試案件，再用新版開啟。"""
import json, sys
from playwright.sync_api import sync_playwright
seed = json.load(open('seed_s.json')); mock = open('/home/claude/test2/mock8.js').read()
res = []; errs = []
def check(t, n, expect, ok, actual=''):
    res.append({'id': t, 'case': n, 'expect': expect, 'result': 'PASS' if ok is True else 'FAIL', 'actual': '' if ok is True else str(actual)[:300]}); print('PASS' if ok is True else 'FAIL', t, n, '' if ok is True else actual)
with sync_playwright() as p:
    b = p.chromium.launch()
    def open_(html, sd):
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}); ctx.add_init_script('window.__autoHabit = false; window.__SEED=' + json.dumps(sd, ensure_ascii=False) + ';' + mock); ctx.route('**/fonts.g*/**', lambda r: r.abort())
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.goto('file:///home/claude/simp/' + html); pg.wait_for_selector('#portal, #loginForm'); return pg
    def login(pg, e):
        if pg.query_selector('[data-act="logout"]'): pg.click('[data-act="logout"]'); pg.wait_for_timeout(300)
        pg.evaluate("go('login', '%s')" % ('applicant' if e.startswith('family') else 'staff')); pg.wait_for_selector('#loginForm'); pg.fill('#loginForm [name=email]', e); pg.fill('#loginForm [name=pw]', 'Test1234'); pg.click('#loginForm button[type=submit]'); pg.wait_for_selector('#top [data-act="logout"]'); pg.wait_for_timeout(500); pg.evaluate("me && me.role === 'family' && myFamilyCases().length && go('home', myFamilyCases()[0].id)"); pg.wait_for_timeout(200)
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

    def nav(pg, a, x=None): pg.evaluate(f"route.page={json.dumps(a)}; route.arg={json.dumps(x)}; reviewState=null; render(true)"); pg.wait_for_timeout(500)
    old = open_('index.pre-real.html', seed); login(old, 'admin@example.com'); nav(old, 'testdata')
    old.click('[data-act="test-seed-missing"]'); old.wait_for_timeout(300); old.click('[data-act="modal-ok"]'); old.wait_for_function("!document.querySelector('.dialog')", timeout=60000); old.wait_for_timeout(800)
    S = old.evaluate("Object.fromEntries([...window.__store.entries()].filter(([k]) => !k.startsWith('data/')).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))"); old.context.close()
    pg = open_('index.html', S); login(pg, 'nurse@example.com')
    ph = pg.evaluate("['TEST-A','TEST-B','TEST-C','TEST-D'].map(c => phase(D.cases[c]))")
    hs = pg.evaluate("['TEST-A','TEST-B','TEST-C','TEST-D'].map(c => habitState(D.cases[c]))")
    check('K1', '上一版建立的測試案件用新版開啟（八大項習慣卡必填）', '沒有習慣卡的 A、B 列為待提交（待補件）；已填但沒有正式初審的 C 列為待審核、摘要卡審核中但不能開放；D 的已開放摘要卡標示待重新審核。資料都沒有被清除', ph == ['待補件', '待補件', '摘要卡審核中', '摘要卡待重新審核'] and hs == ['尚未提交', '尚未提交', '待審核', '待審核'], (ph, hs))
    ch = pg.evaluate("cardChanged(D.cases['TEST-D'])")
    check('K2', '舊的已開放摘要卡：只因新規則標示，不誤判其他資料變更', '吳月娥摘要卡只列「生活與照護習慣卡（尚未完成必要初審）」，其他依據沒有被判為變更；原摘要卡版本保留', ch == ['生活與照護習慣卡（尚未完成必要初審）'] and pg.evaluate("D.cases['TEST-D'].card.v") == 1, ch)
    nav(pg, 'review', 'TEST-A_summary'); labels = pg.evaluate("reviewState.fields.map(f => f.label)")
    check('K3', '舊案件的待核對文件使用新欄位', '出院摘要顯示摘要類型等新欄位', labels[0] == '摘要類型', labels)
    nav(pg, 'doc', 'TEST-C_exam'); t = pg.inner_text('main')
    check('K4', '舊格式的已確認體檢報告仍可查看', '文件頁正常顯示（含核對紀錄與資料層次）', '核對紀錄' in t and '資料層次' in t, t[:200])
    nav(pg, 'card', 'TEST-C'); check('K5', '舊資料的摘要卡審核頁（八大項：習慣卡未初審）', '舊測試資料的習慣卡沒有正式初審紀錄：摘要卡審核頁明確提示「習慣卡尚未完成必要初審」並提供前往初審的按鈕，不直接視為符合', pg.query_selector('#cardHabitBlock') is not None and '尚未完成必要初審' in pg.inner_text('#cardHabitBlock'))
    nav(pg, 'assess', 'TEST-B'); t = pg.inner_text('main'); check('K6', '舊資料的收治評估頁（八大項）', '舊案件沒有正式提交的習慣卡：評估頁說明目前不能評估，原因是生活與照護習慣卡尚未完成必要初審', '目前不能評估' in t and '生活與照護習慣卡' in t, t[:200])
    login(pg, 'care@example.com'); nav(pg, 'card', 'TEST-D'); t = pg.inner_text('main'); check('K7', '照服員查看舊資料摘要卡', '仍可查看原版本內容，並看到「資料已更新，需重新確認」提示（習慣卡尚未完成必要初審）', '月娥阿姨' in t and '資料已更新' in t)
    check('K8', '沒有 JavaScript 錯誤', '主控台沒有錯誤', not errs, errs[:3])
    b.close()
json.dump(res, open('run_compat.json', 'w'), ensure_ascii=False, indent=1); print('TOTAL', len(res), 'PASS', sum(r['result'] == 'PASS' for r in res))
