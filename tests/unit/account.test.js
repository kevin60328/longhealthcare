/* 單元測試：帳號格式檢查（js/modules/rules/account.js），預期值與原型第 (18) 版相同 */
import { describe, it, expect } from 'vitest';
import { pwOk, emailOk, phoneValid, phoneNorm, phoneMsg, portalMismatch } from '../../js/modules/rules/account.js';

describe('密碼', () => {
  it.each([['abc12345', true], ['abcdefgh', false], ['12345678', false], ['ab1', false], ['Kh-miRyUVp1', true], [null, false]])('%s → %s', (p, ok) => expect(pwOk(p)).toBe(ok));
});

describe('電子郵件', () => {
  it.each([['a.b+c@example.com', true], ['bad@', false], ['中文@example.com', false], ['x@y.z', false], ['', false]])('%s → %s', (e, ok) => expect(emailOk(e)).toBe(ok));
});

describe('手機號碼', () => {
  it('接受空白、連字號、括號', () => { expect(phoneValid('0912 345 678')).toBe(true); expect(phoneValid('(0912)-345-678')).toBe(true); });
  it('必須 09 開頭 10 碼', () => { expect(phoneValid('0812345678')).toBe(false); expect(phoneValid('091234567')).toBe(false); });
  it('儲存格式 0912-345-678', () => expect(phoneNorm('0912345678')).toBe('0912-345-678'));
  it('錯誤訊息', () => {
    expect(phoneMsg('')).toBe('請輸入手機號碼');
    expect(phoneMsg('123')).toBe('請輸入正確的手機號碼，例如 0912-345-678');
    expect(phoneMsg('0912345678')).toBe('');
  });
});

describe('入口與帳號類型', () => {
  it('家屬從一般申請人入口：可以', () => expect(portalMismatch('applicant', { role: 'family' })).toBe(''));
  it('員工從一般申請人入口：擋下', () => expect(portalMismatch('applicant', { role: 'staff' })).toMatch('機構工作人員帳號'));
  it('待審核員工（role 為空）看申請的角色', () => {
    expect(portalMismatch('staff', { role: null, want: 'nurse' })).toBe('');
    expect(portalMismatch('applicant', { role: null, want: 'nurse' })).toMatch('機構工作人員帳號');
  });
  it('家屬從機構工作人員入口：擋下', () => expect(portalMismatch('staff', { role: 'family' })).toMatch('一般申請人帳號'));
});
