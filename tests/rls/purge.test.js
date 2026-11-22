/* 清除測試資料（purge_test_data，000019）的界線：只有後端金鑰能執行，只刪測試帳號的資料；其他操作紀錄仍然不能刪。 */
import { describe, it, expect } from 'vitest';
import { as, service } from './helpers.js';

describe('清除測試資料的權限與界線', () => {
  it('行政、管理員都不能執行清除', async () => {
    for (const e of ['staff@example.com', 'admin@example.com']){
      const { error } = await (await as(e)).rpc('purge_test_data');
      expect(error, e).not.toBeNull();
    }
  });
  it('種子案件（C-0001、C-0002、T-A～T-D）都還在', async () => {
    const { data } = await service().from('cases').select('no');
    expect(data.map(c => c.no)).toEqual(expect.arrayContaining(['C-0001', 'C-0002', 'T-A', 'T-B', 'T-C', 'T-D']));
  });
  it('一般的操作紀錄連後端金鑰也不能刪或改', async () => {
    const svc = service();
    const { data } = await svc.from('audit_logs').select('id').not('case_id', 'is', null).limit(1).single();
    expect((await svc.from('audit_logs').delete().eq('id', data.id)).error?.message).toMatch(/只能新增/);
    expect((await svc.from('audit_logs').update({ action: 'x' }).eq('id', data.id)).error?.message).toMatch(/只能新增/);
  });
});
