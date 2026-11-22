/* 單元測試：導覽列分頁與「同一時間只有一個選取分頁」（HANDOFF 6.3）。
 * 對所有角色 × 所有頁面 × 常見 view 檢查：選取的分頁一定存在於畫面實際顯示的分頁清單中。 */
import { describe, it, expect } from 'vitest';
import { navTabs, navCurrent } from '../../js/navigation.js';
import { canEnter } from '../../js/permissions.js';

const me = (role, extra = {}) => ({ role, status: '啟用', ...extra });
const PAGES = ['dashboard', 'application', 'cases', 'documents', 'assessment', 'care-summary', 'settings'];
const VIEWS = ['', 'home', 'notices', 'list', 'assign', 'receipt', 'residents', 'accounts', 'org', 'logs', 'testdata', 'mail-errors', 'x'];
const USERS = [me('family'), me('staff'), me('nurse'), me('nurse', { can_assign_nurse: true }), me('care'), me('admin')];

describe('選取分頁一定在顯示中的分頁清單裡（只會有一個）', () => {
  for (const u of USERS) for (const p of PAGES) for (const v of VIEWS){
    it(`${u.role}${u.can_assign_nurse ? '（可分配）' : ''} ${p}?view=${v}`, () => {
      const keys = navTabs(u).map(t => t[0]);
      expect(keys).toContain(navCurrent(u, p, v, ''));
    });
  }
});

describe('詳細頁歸到所屬分頁', () => {
  it('家屬通知', () => expect(navCurrent(me('family'), 'dashboard', 'notices')).toBe('notices'));
  it('家屬案件詳情歸我的申請', () => expect(navCurrent(me('family'), 'application', '')).toBe('home'));
  /* 階段 6 對照原型修正：收件核對、核對日期、補件追蹤在「工作清單」下；看文件、要求補件等在「案件」下；from 優先 */
  it('行政文件頁：收件核對歸工作清單、看文件歸案件；from=case／from=home 依來源', () => {
    for (const v of ['receipt', 'date', 'followup']) expect(navCurrent(me('staff'), 'documents', v)).toBe('home');
    for (const v of ['doc', 'request', 'add', 'inst', 'mail']) expect(navCurrent(me('staff'), 'documents', v)).toBe('cases');
    expect(navCurrent(me('staff'), 'documents', 'receipt', 'case')).toBe('cases');
    expect(navCurrent(me('staff'), 'documents', 'doc', 'home')).toBe('home');
  });
  it('護理評估頁歸負責住民', () => expect(navCurrent(me('nurse'), 'assessment', '')).toBe('residents'));
  it('有分配權限的護理師在案件分配：只選案件分配', () => expect(navCurrent(me('nurse', { can_assign_nurse: true }), 'cases', 'assign')).toBe('assign'));
  it('沒有分配權限的護理師在案件分配：歸第一個分頁', () => expect(navCurrent(me('nurse'), 'cases', 'assign')).toBe('home'));
  it('管理員未知 view 歸帳號管理', () => expect(navCurrent(me('admin'), 'settings', 'x')).toBe('accounts'));
});

describe('分頁清單', () => {
  it('只有可分配的護理師有「案件分配」', () => {
    expect(navTabs(me('nurse')).map(t => t[0])).toEqual(['home', 'residents']);
    expect(navTabs(me('nurse', { can_assign_nurse: true })).map(t => t[0])).toEqual(['home', 'residents', 'assign']);
  });
});

describe('頁面權限（畫面判斷）', () => {
  it('未啟用帳號哪裡都不能進', () => expect(canEnter({ role: 'staff', status: '待審核' }, 'dashboard', '')).toBe(false));
  it('照服員只能進工作清單與摘要卡', () => {
    expect(PAGES.filter(p => canEnter(me('care'), p, ''))).toEqual(['dashboard', 'care-summary']);
  });
  it('護理只有可分配者能進案件分配，且只能進 assign', () => {
    expect(canEnter(me('nurse'), 'cases', 'assign')).toBe(false);
    expect(canEnter(me('nurse', { can_assign_nurse: true }), 'cases', 'assign')).toBe(true);
    expect(canEnter(me('nurse', { can_assign_nurse: true }), 'cases', 'list')).toBe(false);
  });
  it('只有管理員能進系統管理', () => {
    expect(['family', 'staff', 'nurse', 'care', 'admin'].filter(r => canEnter(me(r), 'settings', 'accounts'))).toEqual(['admin']);
  });
});
