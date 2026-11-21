/* login.html：入口選擇、登入、註冊、忘記密碼、從重設信設定新密碼、修改密碼、帳號審核中（HANDOFF 6.1、6.2）。
 *
 * 網址（每個畫面都是真的網址，瀏覽器「上一頁」可以用）：
 *   login.html                          入口選擇（一般申請人／機構工作人員）
 *   login.html?view=login&portal=…       登入（portal：applicant 或 staff）
 *   login.html?view=register&portal=…    註冊（一般申請人）／新進人員帳號申請
 *   login.html?view=forgot&portal=…      忘記密碼：寄出重設信
 *   login.html?view=reset                從重設信的連結回來，設定新密碼
 *   login.html?view=password             修改密碼；臨時密碼（must_change_password）時強制修改
 *   login.html?view=pending              帳號待審核／已退回／停用
 *   以上都可以帶 next=，登入後回到原本要去的頁面。
 *
 * 規則沿用原型第 (18) 版：
 * - 入口只決定畫面；權限依帳號角色。帳號類型和入口不一致時擋下並說明（工作帳號不能提出入住申請）。
 * - 員工註冊後待審核，家屬註冊後即可使用；註冊不等於提出入住申請。
 * - 忘記密碼依使用者決定做完整流程：由 Supabase Auth 寄出重設信。測試時不實際寄信（自動測試用管理端產生連結）。 */
import { supabase } from '../api/supabase.js';
import { getSession, loadProfile, afterLoginUrl, loginUrl, logout } from '../auth.js';
import { homeOf } from '../permissions.js';
import { mountShell } from '../navigation.js';
import { getOrg } from './services/org.js';
import { esc, helpLine, fieldErr, onSubmit, decorateRequired, errText, setFlash, showFlash } from '../ui.js';
import { ROLE_NAME, pwOk, PW_HINT, emailOk, phoneMsg, phoneNorm, portalMismatch } from './rules/account.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || '';
const portal = ['applicant', 'staff'].includes(params.get('portal')) ? params.get('portal') : '';
const next = params.get('next') || '';
const PORTAL_NAME = { applicant: '一般申請人', staff: '機構工作人員' };

const main = document.getElementById('main');
let org = null, me = null, session = null, shell = null;
let recoveryError = '';     // 重設連結無效或過期的原因（handleRecoveryLink 設定）；要在 init() 執行前宣告

/* 同一頁內換畫面時保留 next */
const link = (p = {}) => loginUrl({ ...p, next });

init();

async function init(){
  try {
    /* 從重設信回來：網址可能帶 #error=…（連結過期）或 ?token_hash=…，要在讀 session 之前處理 */
    if (view === 'reset') await handleRecoveryLink();
    [org, session] = await Promise.all([getOrg(), getSession()]);
    me = session ? await loadProfile(session.user.id) : null;
  } catch (e){
    shell = mountShell({ orgName: org?.name, page: 'login' });
    main.innerHTML = `<div class="auth card stack"><h1>無法連線</h1><p>${esc(errText(e))}</p><button type="button" class="btn primary" id="retry">重新載入</button></div>`;
    main.querySelector('#retry').addEventListener('click', () => location.reload());
    return;
  }
  shell = mountShell({ orgName: org?.name, me, page: 'login', view, onLogout: logout });
  showFlash();

  /* 已經登入的人打開入口、登入、註冊、忘記密碼畫面：直接帶去該去的地方 */
  if (session && me && ['', 'login', 'register', 'forgot'].includes(view)) return location.replace(afterLoginUrl(me, next));
  /* 需要登入的畫面 */
  if (['password', 'pending'].includes(view) && !(session && me)) return location.replace(loginUrl());
  if (view === 'pending' && me.status === '啟用') return location.replace(afterLoginUrl(me, next));

  const render = { login: viewLogin, register: viewRegister, forgot: viewForgot, reset: viewReset, password: viewPassword, pending: viewPending }[view];
  if (render && (view !== 'login' || portal)) render(); else viewPortal();
  decorateRequired(main);
  const h = main.querySelector('h1, h2'); if (h){ h.tabIndex = -1; h.focus({ preventScroll: true }); }
}

const head = sub => `<div class="portal-head"><p class="org">${esc(org?.name || '')}</p><p class="sub">入住前收件系統${sub ? '｜' + esc(sub) : ''}</p></div>`;

/* ---------- 入口選擇 ---------- */
function viewPortal(){
  const msg = params.get('msg') === 'noprofile' ? '<div class="notice bad small">帳號資料不完整，無法登入。請聯絡機構。</div>' : '';
  main.innerHTML = `<div class="auth stack" id="portal" style="max-width:640px">${head()}${msg}
    <div class="card stack"><h1 style="font-size:1.2em;margin:0">請選擇登入入口</h1>
      <div class="portal-grid">
        <a class="portal-btn" href="${link({ view: 'login', portal: 'applicant' })}"><span class="t">一般申請人</span><span class="small muted">為自己或家人申請入住、上傳文件、查看申請進度。第一次使用請先註冊。</span></a>
        <a class="portal-btn" href="${link({ view: 'login', portal: 'staff' })}"><span class="t">機構工作人員</span><span class="small muted">行政／社工、護理人員、照顧服務員、系統管理員。新進人員可申請帳號。</span></a>
      </div>
      <p class="small muted" style="margin:0">機構工作人員本人或家人要申請入住，請用個人電子郵件另外註冊一般申請人帳號；工作帳號不能提出入住申請。</p>
    </div>${helpLine(org)}</div>`;
}

/* ---------- 登入 ---------- */
function viewLogin(){
  const app = portal === 'applicant';
  main.innerHTML = `<div class="auth stack">${head(PORTAL_NAME[portal])}
    ${app && /application\.html/.test(next) ? '<div class="notice info small">請先登入或註冊一般申請人帳號，完成後會直接回到入住申請表。</div>' : ''}
    <form class="card stack" id="loginForm" novalidate>
      <h2>${app ? '一般申請人登入' : '機構工作人員登入'}</h2>
      <label class="f" data-req>電子郵件<input type="email" name="email" autocomplete="username"></label>
      <label class="f" data-req>密碼<input type="password" name="pw" autocomplete="current-password"></label>
      <div class="err" id="loginErr" role="alert"></div>
      <button type="submit" class="btn primary big">登入</button>
      <div class="row between small"><a class="link" href="${link({ view: 'forgot', portal })}">忘記密碼</a><a class="link" href="${link({ view: 'register', portal })}">${app ? '註冊一般申請人帳號' : '新進人員帳號申請'}</a></div>
      ${app ? '<p class="small muted" style="margin:0">註冊後會先進入個人首頁，需要時再提出入住申請。</p>' : '<p class="small muted" style="margin:0">登入後依系統管理員核准的角色進入工作畫面，無法自行選擇角色。</p>'}
    </form>
    <a class="btn" href="${link()}">← 返回入口選擇</a>${helpLine(org)}</div>`;
  const form = main.querySelector('#loginForm'), err = main.querySelector('#loginErr');
  onSubmit(form, async d => {
    const email = String(d.get('email') || '').trim().toLowerCase(), pw = String(d.get('pw') || '');
    if (!email || !pw){ err.textContent = '請輸入電子郵件和密碼'; return; }
    err.textContent = '';
    const db = supabase();
    const { data, error } = await db.auth.signInWithPassword({ email, password: pw });
    if (error){ err.textContent = signInError(error); return; }
    let profile;
    try { profile = await loadProfile(data.user.id); } catch (e){ await db.auth.signOut({ scope: 'local' }); err.textContent = '登入失敗：' + errText(e); return; }
    if (!profile){ await db.auth.signOut({ scope: 'local' }); err.textContent = '帳號資料不完整，無法登入。請聯絡機構。'; return; }
    /* 入口只檢查帳號類型是否一致；不一致就登出，不進入任何畫面 */
    const mis = portalMismatch(portal, profile);
    if (mis){ await db.auth.signOut({ scope: 'local' }); err.textContent = mis; return; }
    /* 最後登入時間：寫入失敗不影響登入 */
    if (profile.status === '啟用'){ const r = await db.rpc('record_login'); if (r.error) console.warn('最後登入時間沒有記錄', r.error); }
    location.replace(afterLoginUrl(profile, next));
  });
}

function signInError(e){
  if (e.code === 'invalid_credentials' || /Invalid login credentials/i.test(e.message)) return '電子郵件或密碼不正確';
  if (e.code === 'email_not_confirmed' || /Email not confirmed/i.test(e.message)) return '這個帳號還沒完成電子郵件驗證，請先到信箱點驗證連結再登入。';
  return '登入失敗：' + errText(e);
}

/* ---------- 註冊 ---------- */
function viewRegister(){
  const staff = portal === 'staff';
  main.innerHTML = `<div class="auth stack" style="max-width:520px">
    <div><h1>${staff ? '申請機構人員帳號' : '註冊一般申請人帳號'}</h1><p class="lead">${esc(org?.name || '')}　入住前收件系統</p></div>
    <form class="card stack" id="regForm" novalidate>
      ${staff ? '<p class="small notice info" style="margin:0">註冊後需由系統管理員核准角色才能使用。要為自己或家人申請入住，請改用個人電子郵件註冊「一般申請人」帳號。</p>' : '<p class="small muted" style="margin:0">註冊完成後會進入您的個人首頁。<strong>註冊不等於提出入住申請</strong>，需要時再按「我要申請入住」。</p>'}
      ${staff ? '<label class="f" data-req>申請的角色<select name="want"><option value="">請選擇</option><option value="staff">行政／社工</option><option value="nurse">護理人員</option><option value="care">照顧服務員</option></select></label>' : ''}
      <label class="f" data-req>姓名<input type="text" name="name" autocomplete="name"></label>
      <label class="f" data-req>電子郵件<span class="hint">用來登入系統${staff ? '' : '，也是申請確認通知的收件信箱'}</span><input type="email" name="email" autocomplete="email"></label>
      <label class="f" data-req>手機號碼<span class="hint">${staff ? '機構聯絡用' : '機構承辦人確認身分時會打這支電話'}，例：0912-345-678</span><input type="tel" name="phone" autocomplete="tel" placeholder="0912-345-678"></label>
      <label class="f" data-req>密碼<span class="hint">${PW_HINT}</span><input type="password" name="pw" autocomplete="new-password"></label>
      <label class="f" data-req>確認密碼<span class="hint">再輸入一次密碼</span><input type="password" name="pw2" autocomplete="new-password"></label>
      <p class="small muted" style="margin:0">如果系統寄出驗證信，請先到信箱點驗證連結，再回來登入。</p>
      <div class="err" id="regErr" role="alert"></div>
      <button type="submit" class="btn primary big">${staff ? '送出申請' : '註冊'}</button>
      <p class="small">已經有帳號？<a class="link" href="${link({ view: 'login', portal: portal || 'applicant' })}">回到登入</a></p>
    </form></div>`;
  const form = main.querySelector('#regForm'), err = main.querySelector('#regErr');
  onSubmit(form, async d => {
    const name = String(d.get('name') || '').trim(), email = String(d.get('email') || '').trim().toLowerCase(), phone = String(d.get('phone') || '').trim();
    const pw = String(d.get('pw') || ''), pw2 = String(d.get('pw2') || ''), want = staff ? String(d.get('want') || '') : 'family';
    /* 逐欄檢查，錯誤顯示在欄位旁；不清空已填的內容 */
    const errs = [];
    const chk = (k, msg) => { fieldErr(form, k, msg); if (msg) errs.push(msg); };
    if (staff) chk('want', ['staff', 'nurse', 'care'].includes(want) ? '' : '請選擇申請的角色');
    chk('name', name ? '' : '請填寫姓名');
    chk('email', !email ? '請填寫電子郵件' : emailOk(email) ? '' : '電子郵件格式不正確（只能使用英文字母、數字與 . _ + -）');
    chk('phone', phoneMsg(phone));
    chk('pw', !pw ? '請設定密碼' : pwOk(pw) ? '' : '密碼' + PW_HINT);
    chk('pw2', !pw2 ? '請再輸入一次密碼' : pw === pw2 ? '' : '兩次輸入的密碼不一樣');
    if (errs.length){ err.textContent = '請修正標示的欄位：' + errs[0] + (errs.length > 1 ? `（共 ${errs.length} 項）` : ''); return; }
    err.textContent = '';

    const { data, error } = await supabase().auth.signUp({
      email, password: pw,
      options: {
        data: { name, phone: phoneNorm(phone), want },     // 角色由資料庫決定：員工待審核，家屬直接啟用
        emailRedirectTo: new URL(loginUrl({ view: 'login', portal: staff ? 'staff' : 'applicant' }), location.href).href
      }
    });
    if (error){ err.textContent = signUpError(error); return; }
    /* 已註冊過的電子郵件：開啟驗證信時 Supabase 不回錯誤，而是回傳沒有 identities 的使用者 */
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){ err.textContent = '這個電子郵件已經註冊過了，請直接登入'; return; }
    if (data.session){
      setFlash(staff ? '註冊完成，等待系統管理員審核' : '註冊完成');
      const profile = await loadProfile(data.user.id).catch(() => null);
      return location.replace(profile ? afterLoginUrl(profile, next) : homeOf({ role: 'family' }));
    }
    /* 需要電子郵件驗證：帳號已建立，請使用者去收信 */
    main.innerHTML = `<div class="auth stack"><div class="card hero ok stack"><h1>${staff ? '申請已送出' : '註冊完成'}</h1>
      <p>系統已寄出驗證信到 <strong>${esc(email)}</strong>。請到信箱點驗證連結，再回來登入。</p>
      ${staff ? '<p>驗證完成後，還需要系統管理員核准角色才能使用。</p>' : ''}
      <p class="small muted">沒有收到信？請檢查垃圾郵件，或聯絡機構。</p>
      <a class="btn primary" href="${link({ view: 'login', portal: staff ? 'staff' : 'applicant' })}">回到登入</a></div>${helpLine(org)}</div>`;
  });
}

function signUpError(e){
  if (e.code === 'user_already_exists' || /already registered/i.test(e.message)) return '這個電子郵件已經註冊過了，請直接登入';
  if (e.code === 'weak_password') return '密碼強度不足：' + PW_HINT;
  if (/Database error saving new user/i.test(e.message)) return '註冊失敗：資料沒有儲存。請確認姓名與手機號碼後再試一次。';
  if (e.status === 429 || e.code === 'over_email_send_rate_limit') return '操作太頻繁，請稍後再試';
  return '註冊失敗：' + errText(e);
}

/* ---------- 忘記密碼：寄出重設信 ---------- */
function viewForgot(){
  main.innerHTML = `<div class="auth stack">
    <form class="card stack" id="forgotForm" novalidate>
      <h1>忘記密碼</h1>
      <p>請輸入註冊時使用的電子郵件，系統會寄出重設密碼的連結。</p>
      <label class="f" data-req>電子郵件<input type="email" name="email" autocomplete="username"></label>
      <div class="err" id="forgotErr" role="alert"></div>
      <button type="submit" class="btn primary big">寄出重設密碼信</button>
      <p class="small muted" style="margin:0">收不到信時，也可以聯絡機構，由系統管理員為您重設密碼。</p>
    </form>
    <a class="btn" href="${link({ view: 'login', portal })}">← 回到登入</a>${helpLine(org)}</div>`;
  const form = main.querySelector('#forgotForm'), err = main.querySelector('#forgotErr');
  onSubmit(form, async d => {
    const email = String(d.get('email') || '').trim().toLowerCase();
    const m = !email ? '請輸入電子郵件' : emailOk(email) ? '' : '電子郵件格式不正確';
    fieldErr(form, 'email', m); if (m){ err.textContent = m; return; }
    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: new URL('login.html?view=reset', location.href).href
    });
    if (error){
      err.textContent = (error.status === 429 || /rate limit/i.test(error.message)) ? '寄送太頻繁，請稍後再試' : '寄送失敗：' + errText(error) + '，請再試一次。';
      return;
    }
    /* 不透露這個電子郵件有沒有註冊（避免被用來查詢帳號） */
    form.outerHTML = `<div class="card hero ok stack"><h1>請到信箱收信</h1>
      <p>如果 <strong>${esc(email)}</strong> 有註冊帳號，系統已寄出重設密碼的連結。請點信中的連結設定新密碼。</p>
      <p class="small muted">幾分鐘內沒收到，請檢查垃圾郵件，或聯絡機構由系統管理員重設密碼。</p></div>`;
  });
}

/* ---------- 從重設信回來：設定新密碼 ---------- */
async function handleRecoveryLink(){
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error')){
    recoveryError = hash.get('error_code') === 'otp_expired' ? '這個重設連結已經過期或已經用過了。' : '這個重設連結無效。';
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  /* 另一種連結格式（token_hash）：在頁面上驗證。自動測試也走這條，不用真的寄信 */
  const th = params.get('token_hash');
  if (th){
    const { error } = await supabase().auth.verifyOtp({ token_hash: th, type: 'recovery' });
    if (error) recoveryError = '這個重設連結已經過期或已經用過了。';
    history.replaceState(null, '', location.pathname + '?view=reset');
  }
  /* 預設格式（#access_token=…&type=recovery）由 supabase-js 讀取網址後自動建立 session */
}

function viewReset(){
  if (!session || !me || recoveryError){
    main.innerHTML = `<div class="auth stack"><div class="card hero bad stack"><h1>無法重設密碼</h1>
      <p>${esc(recoveryError || '這個重設連結無效或已經過期。')}請重新申請重設密碼信。</p>
      <a class="btn primary" href="${link({ view: 'forgot' })}">重新申請</a></div>${helpLine(org)}</div>`;
    return;
  }
  passwordForm({ title: '設定新密碼', intro: `帳號：${esc(session.user.email)}`, needOld: false, done: () => location.replace(afterLoginUrl({ ...me, must_change_password: false }, '')) });
}

/* ---------- 修改密碼（臨時密碼時強制） ---------- */
function viewPassword(){
  const force = !!me.must_change_password;
  passwordForm({
    title: force ? '請設定新密碼' : '修改密碼',
    intro: force ? '您目前使用的是臨時密碼，請改成您自己的密碼後再繼續使用。' : '',
    needOld: !force,
    cancel: force ? '' : homeOf(me),
    done: () => force ? location.replace(afterLoginUrl({ ...me, must_change_password: false }, next)) : location.assign(homeOf(me))
  });
}

/* 新密碼表單：Supabase Auth 更新密碼 → 確認成功 → 資料庫清除「需要改密碼」並記錄。
 * 第二步失敗時密碼其實已經更新，畫面要說清楚並提供重試（不能顯示成完成）。 */
function passwordForm({ title, intro, needOld, cancel, done }){
  main.innerHTML = `<div class="auth stack"><form class="card stack" id="pwForm" novalidate>
    <h1>${title}</h1>${intro ? `<p>${intro}</p>` : ''}
    ${needOld ? '<label class="f" data-req>目前的密碼<input type="password" name="old" autocomplete="current-password"></label>' : ''}
    <label class="f" data-req>新密碼<span class="hint">${PW_HINT}</span><input type="password" name="pw" autocomplete="new-password"></label>
    <label class="f" data-req>確認新密碼<input type="password" name="pw2" autocomplete="new-password"></label>
    <div class="err" id="pwErr" role="alert"></div>
    <button type="submit" class="btn primary big">儲存新密碼</button>
    ${cancel ? `<a class="back" href="${cancel}">← 取消</a>` : ''}
  </form></div>`;
  const form = main.querySelector('#pwForm'), err = main.querySelector('#pwErr');
  let pwUpdated = false;     // 密碼已更新、只差資料庫紀錄時，重試不用再改一次密碼
  onSubmit(form, async d => {
    const db = supabase();
    if (!pwUpdated){
      const pw = String(d.get('pw') || ''), pw2 = String(d.get('pw2') || '');
      if (needOld){
        const old = String(d.get('old') || '');
        if (!old){ err.textContent = '請輸入目前的密碼'; return; }
        const chk = await db.auth.signInWithPassword({ email: session.user.email, password: old });
        if (chk.error){ err.textContent = chk.error.code === 'invalid_credentials' || /Invalid login/i.test(chk.error.message) ? '目前的密碼不正確' : '無法確認目前的密碼：' + errText(chk.error); return; }
      }
      if (!pwOk(pw)){ err.textContent = '密碼' + PW_HINT; return; }
      if (pw !== pw2){ err.textContent = '兩次輸入的密碼不一樣'; return; }
      const { error } = await db.auth.updateUser({ password: pw });
      if (error){
        err.textContent = error.code === 'same_password' ? '新密碼不能和目前的密碼相同' : '密碼更新失敗：' + errText(error) + '。目前的密碼仍有效，請再試一次。';
        return;
      }
      pwUpdated = true;
    }
    const r = await db.rpc('password_changed');
    if (r.error){
      err.textContent = '新密碼已生效，但系統紀錄沒有寫入（' + errText(r.error) + '）。請按「重試」完成。';
      form.querySelector('button[type=submit]').textContent = '重試';
      form.querySelectorAll('input').forEach(i => { i.disabled = true; });
      return;
    }
    setFlash('密碼已更新');
    done();
  });
}

/* ---------- 帳號審核中／已退回／停用 ---------- */
function viewPending(){
  const st = me.status;
  const txt = st === '待審核' ? `您申請「${ROLE_NAME[me.want] || ''}」的帳號正在等待系統管理員審核，核准後就能使用。`
    : st === '已退回' ? '您的角色申請未通過。如有疑問請聯絡機構。' : '您的帳號已停用。如有疑問請聯絡機構。';
  main.innerHTML = `<div class="auth stack"><div class="card hero ${st === '待審核' ? 'warn' : 'bad'} stack"><h1>${st === '待審核' ? '帳號審核中' : '無法使用'}</h1><p>${esc(txt)}</p><button type="button" class="btn" id="pendingLogout">登出</button></div>${helpLine(org)}</div>`;
  main.querySelector('#pendingLogout').addEventListener('click', logout);
}
