/* 階段 10：讀取資料遇到暫時性錯誤時自動再讀一次（js/modules/services/model.js isTransient）。
 * 只有逾時、網路中斷、5xx 會重試；權限錯誤、資料錯誤不重試，直接顯示給使用者。 */
import { describe, it, expect } from 'vitest';
import { isTransient } from '../../js/modules/services/model.js';

describe('暫時性錯誤判斷', () => {
  it('會重試：資料庫查詢逾時、網路中斷、伺服器 5xx', () => {
    expect(isTransient({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isTransient({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isTransient({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true);
    expect(isTransient({ status: 503, message: 'Service Unavailable' })).toBe(true);
  });
  it('不重試：沒有錯誤、權限不足、資料錯誤、找不到', () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient({ code: '42501', message: 'permission denied for table cases' })).toBe(false);
    expect(isTransient({ code: 'P0001', message: '只有系統管理員可以執行' })).toBe(false);
    expect(isTransient({ code: 'PGRST116', status: 406, message: 'JSON object requested, multiple (or no) rows returned' })).toBe(false);
  });
});
